import { spawn, ChildProcess } from "node:child_process"
import { ClaudeResult } from "../../types"
import { extractResult } from "./stream.decode"

export type InvokeOptions = {
  systemPrompt: string
  userPrompt: string
  model: string
  allowedTools?: string[]
  agents?: Record<string, { description: string; prompt: string; model?: string }>
  pluginDirs?: string[]
  cwd: string
  timeoutMs?: number
  sessionId?: string
  jsonSchema?: string
  onStdout?: (chunk: string) => void
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

    const proc: ChildProcess = spawn("claude", args, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdoutData = ""
    let stderrData = ""

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8")
      stdoutData += text
      opts.onStdout?.(text)
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrData += chunk.toString("utf-8")
    })

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

      if (timedOut) {
        reject(new Error("Claude invocation timed out"))
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
