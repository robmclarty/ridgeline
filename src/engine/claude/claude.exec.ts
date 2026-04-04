import { spawn, ChildProcess } from "node:child_process"
import { ClaudeResult } from "../../types"
import { extractResult } from "./stream.decode"
import { SandboxProvider } from "./sandbox"

/** Default: kill if no stdout arrives within 2 minutes of spawn. */
const DEFAULT_STARTUP_TIMEOUT_MS = 2 * 60 * 1000

/** Default: kill if no stdout arrives for 5 minutes during execution. */
const DEFAULT_STALL_TIMEOUT_MS = 5 * 60 * 1000

export type InvokeOptions = {
  systemPrompt: string
  userPrompt: string
  model: string
  allowedTools?: string[]
  agents?: Record<string, { description: string; prompt: string; model?: string }>
  pluginDirs?: string[]
  cwd: string
  timeoutMs?: number
  /** Kill if no stdout within this many ms of spawn (default: 2 min). */
  startupTimeoutMs?: number
  /** Kill if no stdout for this many ms during execution (default: 5 min). */
  stallTimeoutMs?: number
  sessionId?: string
  jsonSchema?: string
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  sandboxProvider?: SandboxProvider | null
  networkAllowlist?: string[]
  additionalWritePaths?: string[]
}

export const invokeClaude = (opts: InvokeOptions): Promise<ClaudeResult> => {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      "-p",
      "--output-format", "stream-json",
      "--model", opts.model,
      "--verbose",
    ]

    if (opts.allowedTools && opts.allowedTools.length > 0) {
      args.push("--allowedTools", opts.allowedTools.join(","))
    }

    if (opts.sessionId) {
      args.push("--resume", opts.sessionId)
    }

    if (opts.agents && Object.keys(opts.agents).length > 0) {
      args.push("--agents", JSON.stringify(opts.agents))
    }

    if (opts.pluginDirs) {
      for (const dir of opts.pluginDirs) {
        args.push("--plugin-dir", dir)
      }
    }

    if (opts.jsonSchema) {
      args.push("--json-schema", opts.jsonSchema)
    }

    // System prompt passed via --system-prompt flag
    args.push("--system-prompt", opts.systemPrompt)

    const provider = opts.sandboxProvider ?? null
    const spawnCmd = provider ? provider.command : "claude"
    const spawnArgs = provider
      ? [...provider.buildArgs(opts.cwd, opts.networkAllowlist ?? [], opts.additionalWritePaths), "claude", ...args]
      : args

    const proc: ChildProcess = spawn(spawnCmd, spawnArgs, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdoutData = ""
    let stderrData = ""
    // --- Stall / startup detection ---
    let stalled = false
    let stallReason = ""
    const startupMs = opts.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    const stallMs = opts.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS

    const killOnStall = (reason: string) => {
      stalled = true
      stallReason = reason
      proc.kill("SIGTERM")
      setTimeout(() => proc.kill("SIGKILL"), 5000)
    }

    // Startup probe: short fuse for the very first stdout event
    let stallTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      killOnStall(`No output received within ${Math.round(startupMs / 1000)}s of spawn (startup timeout)`)
    }, startupMs)

    const resetStallTimer = () => {
      if (stalled) return
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        killOnStall(`No output received for ${Math.round(stallMs / 1000)}s (stall timeout)`)
      }, stallMs)
    }

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8")
      stdoutData += text
      resetStallTimer()
      opts.onStdout?.(text)
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8")
      stderrData += text
      opts.onStderr?.(text)
    })

    // --- Global timeout ---
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | null = null

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true
        proc.kill("SIGTERM")
        setTimeout(() => proc.kill("SIGKILL"), 5000)
      }, opts.timeoutMs)
    }

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer)
      if (stallTimer) clearTimeout(stallTimer)

      if (timedOut) {
        reject(new Error("Claude invocation timed out"))
        return
      }

      if (stalled) {
        reject(new Error(`Claude invocation stalled: ${stallReason}`))
        return
      }

      if (code !== 0 && !stdoutData.trim()) {
        reject(new Error(`claude exited with code ${code}: ${stderrData}`))
        return
      }

      try {
        resolve(extractResult(stdoutData))
      } catch (err) {
        reject(new Error(`Failed to parse claude output: ${err}`))
      }
    })

    // Pipe user prompt via stdin
    proc.stdin?.write(opts.userPrompt)
    proc.stdin?.end()
  })
}
