import { spawn, ChildProcess } from "node:child_process"
import { ClaudeResult } from "../../types"
import { extractResult } from "./stream.result"
import { SandboxProvider } from "./sandbox"
import {
  computeStableHash,
  detectExcludeDynamicFlag,
  writeStablePromptFile,
  shouldLogUnavailableOnce,
  type HelpRunner,
} from "./stable.prompt"
import { logTrajectory } from "../../stores/trajectory"

/** Default: kill if no stdout arrives within 2 minutes of spawn. */
const DEFAULT_STARTUP_TIMEOUT_MS = 2 * 60 * 1000

/** Default: kill if no stdout arrives for 10 minutes during execution. */
const DEFAULT_STALL_TIMEOUT_MS = 10 * 60 * 1000

// --- Process registry: track all live Claude subprocesses ---
const liveProcs = new Set<ChildProcess>()

/** Graceful kill: SIGTERM all process groups, then SIGKILL after 2s. */
export const killAllClaude = (): void => {
  for (const proc of liveProcs) {
    if (proc.pid) {
      try { process.kill(-proc.pid, "SIGTERM") } catch { /* already dead */ }
    }
  }
  setTimeout(() => {
    for (const proc of liveProcs) {
      if (proc.pid) {
        try { process.kill(-proc.pid, "SIGKILL") } catch { /* already dead */ }
      }
    }
  }, 2000)
}

/** Immediate kill: SIGKILL all process groups. Use before process.exit(). */
export const killAllClaudeSync = (): void => {
  for (const proc of liveProcs) {
    if (proc.pid) {
      try { process.kill(-proc.pid, "SIGKILL") } catch { /* already dead */ }
    }
  }
}

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
  /**
   * Stable-block content (constraints.md → taste.md → spec.md) written to a
   * per-invocation temp file and attached via --append-system-prompt-file.
   * Only applied when the Claude CLI advertises --exclude-dynamic-system-prompt-sections.
   */
  stablePrompt?: string
  /** Build directory for trajectory logging of prompt_stable_hash events. */
  buildDir?: string
  /** Test hook: stub `claude --help` flag detection. */
  helpRunner?: HelpRunner
}

const buildBaseArgs = (opts: InvokeOptions): string[] => {
  const args: string[] = [
    "-p",
    "--output-format", "stream-json",
    "--model", opts.model,
    "--verbose",
    "--setting-sources", "project,local",
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

  return args
}

const logStableHash = (buildDir: string | undefined, hash: string): void => {
  if (!buildDir) return
  try {
    logTrajectory(buildDir, "prompt_stable_hash", null,
      `stable prompt sha256: ${hash}`,
      { promptStableHash: hash })
  } catch { /* best-effort */ }
}

const logCachingUnavailable = (buildDir: string | undefined): void => {
  if (!buildDir || !shouldLogUnavailableOnce()) return
  try {
    logTrajectory(buildDir, "prompt_stable_hash", null,
      "caching code path skipped: claude CLI does not expose --exclude-dynamic-system-prompt-sections",
      { reason: "cli_flag_unavailable" })
  } catch { /* best-effort */ }
}

// The Claude CLI rejects --append-system-prompt and --append-system-prompt-file
// together, so when caching is on we fold the dynamic system prompt into the
// file behind the stable prefix (which preserves the cacheable bytes upstream).
const applyCachingArgs = (args: string[], opts: InvokeOptions): boolean => {
  if (!opts.stablePrompt || opts.stablePrompt.length === 0) return false
  if (!detectExcludeDynamicFlag(opts.helpRunner)) {
    logCachingUnavailable(opts.buildDir)
    return false
  }
  const combined = opts.systemPrompt && opts.systemPrompt.length > 0
    ? `${opts.stablePrompt}\n${opts.systemPrompt}`
    : opts.stablePrompt
  const file = writeStablePromptFile(combined)
  args.push("--append-system-prompt-file", file.path)
  args.push("--exclude-dynamic-system-prompt-sections")
  logStableHash(opts.buildDir, computeStableHash(opts.stablePrompt))
  return true
}

// Guard: the Claude CLI rejects --append-system-prompt and
// --append-system-prompt-file together. Catch any future regression at the
// assembly site rather than relying on the CLI's exit-code-1 surface.
export const assertSystemPromptFlagsExclusive = (args: string[]): void => {
  if (args.includes("--append-system-prompt") && args.includes("--append-system-prompt-file")) {
    throw new Error(
      "claude args contain both --append-system-prompt and --append-system-prompt-file; the Claude CLI rejects this combination",
    )
  }
}

const classifyCloseError = (code: number | null, stderrData: string): Error => {
  const lower = stderrData.toLowerCase()
  const isAuth = lower.includes("authentication") || lower.includes("unauthorized") ||
    lower.includes("forbidden") || lower.includes("oauth token has expired") ||
    lower.includes("invalid_api_key")
  return isAuth
    ? new Error("Authentication failed. Refresh your OAuth token or API key and resume.")
    : new Error(`claude exited with code ${code}: ${stderrData}`)
}

export const invokeClaude = async (opts: InvokeOptions): Promise<ClaudeResult> => {
  const provider = opts.sandboxProvider ?? null
  if (provider?.syncRules) {
    await provider.syncRules(opts.networkAllowlist ?? [])
  }

  return new Promise((resolve, reject) => {
    const args = buildBaseArgs(opts)
    const cached = applyCachingArgs(args, opts)
    // Append the dynamic system prompt directly only when caching didn't
    // already fold it into --append-system-prompt-file.
    if (!cached) {
      args.push("--append-system-prompt", opts.systemPrompt)
    }
    assertSystemPromptFlagsExclusive(args)

    const spawnCmd = provider ? provider.command : "claude"
    const spawnArgs = provider
      ? [...provider.buildArgs(opts.cwd, opts.networkAllowlist ?? [], opts.additionalWritePaths), "claude", ...args]
      : args

    const proc: ChildProcess = spawn(spawnCmd, spawnArgs, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      env: provider?.env ? { ...process.env, ...provider.env() } : process.env,
    })
    liveProcs.add(proc)

    let stdoutData = ""
    let stderrData = ""
    // --- Stall / startup detection ---
    let stalled = false
    let stallReason = ""
    const startupMs = opts.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    const stallMs = opts.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS

    const killProc = (signal: NodeJS.Signals) => {
      if (proc.pid) {
        try { process.kill(-proc.pid, signal) } catch { /* already dead */ }
      }
    }

    const killOnStall = (reason: string) => {
      stalled = true
      stallReason = reason
      killProc("SIGTERM")
      setTimeout(() => killProc("SIGKILL"), 5000)
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
        killProc("SIGTERM")
        setTimeout(() => killProc("SIGKILL"), 5000)
      }, opts.timeoutMs)
    }

    proc.on("close", (code) => {
      liveProcs.delete(proc)
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
        reject(classifyCloseError(code, stderrData))
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
