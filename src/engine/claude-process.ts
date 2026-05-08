import { spawn, ChildProcess } from "node:child_process"
import { ClaudeResult } from "../types.js"
import { SandboxProvider } from "./claude/sandbox.js"
import {
  computeStableHash,
  detectExcludeDynamicFlag,
  writeStablePromptFile,
  shouldLogUnavailableOnce,
  type HelpRunner,
} from "./claude/stable.prompt.js"
import { logTrajectory } from "../stores/trajectory.js"

const DEFAULT_STARTUP_TIMEOUT_MS = 2 * 60 * 1000
const DEFAULT_STALL_TIMEOUT_MS = 10 * 60 * 1000

const liveProcs = new Set<ChildProcess>()

export const killAllClaudeSync = (): void => {
  for (const proc of liveProcs) {
    if (proc.pid) {
      try { process.kill(-proc.pid, "SIGKILL") } catch { /* already dead */ }
    }
  }
}

export type ClaudeProcessOptions = {
  systemPrompt: string
  userPrompt: string
  model: string
  allowedTools?: string[]
  agents?: Record<string, { description: string; prompt: string; model?: string }>
  pluginDirs?: string[]
  cwd: string
  timeoutMs?: number
  startupTimeoutMs?: number
  stallTimeoutMs?: number
  sessionId?: string
  jsonSchema?: string
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  sandboxProvider?: SandboxProvider | null
  sandboxMode?: import("../stores/settings.js").SandboxMode
  sandboxExtras?: import("../stores/settings.js").SandboxExtras
  networkAllowlist?: string[]
  additionalWritePaths?: string[]
  stablePrompt?: string
  buildDir?: string
  helpRunner?: HelpRunner
}

const buildBaseArgs = (opts: ClaudeProcessOptions): string[] => {
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
    for (const dir of opts.pluginDirs) args.push("--plugin-dir", dir)
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

const applyCachingArgs = (args: string[], opts: ClaudeProcessOptions): boolean => {
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

interface ResultParsedShape {
  success: boolean
  result: string
  durationMs: number
  costUsd: number
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
  }
  sessionId: string
}

const parseResultRecord = (parsed: Record<string, unknown>): ResultParsedShape => {
  const result = parsed.result
  const usageRec = parsed.usage as Record<string, number> | undefined
  return {
    success: !parsed.is_error,
    result: typeof result === "string"
      ? result
      : (result != null ? JSON.stringify(result) : ""),
    durationMs: (parsed.duration_ms as number) ?? 0,
    costUsd: (parsed.total_cost_usd as number) ?? 0,
    usage: {
      inputTokens: usageRec?.input_tokens ?? 0,
      outputTokens: usageRec?.output_tokens ?? 0,
      cacheReadInputTokens: usageRec?.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: usageRec?.cache_creation_input_tokens ?? 0,
    },
    sessionId: (parsed.session_id as string) ?? "",
  }
}

interface ContentFallbacks {
  textParts: string[]
  structuredOutput: string | null
}

const collectContentFallbacks = (parsed: Record<string, unknown>, acc: ContentFallbacks): void => {
  if (parsed.type === "assistant" && parsed.message) {
    const content = (parsed.message as Record<string, unknown>).content as Array<Record<string, unknown>> | undefined
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_use" && block.name === "StructuredOutput" && block.input != null) {
          acc.structuredOutput = typeof block.input === "string"
            ? block.input
            : JSON.stringify(block.input)
        }
        if (block.type === "text" && typeof block.text === "string") {
          acc.textParts.push(block.text as string)
        }
      }
    }
  }
  if (parsed.type === "assistant" && parsed.subtype === "text" && typeof parsed.text === "string") {
    acc.textParts.push(parsed.text as string)
  }
}

export const extractClaudeResultFromNdjson = (ndjsonStdout: string): ClaudeResult => {
  const lines = ndjsonStdout.trim().split("\n")
  const fallbacks: ContentFallbacks = { textParts: [], structuredOutput: null }
  let resultEvent: ClaudeResult | null = null
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      if (parsed.type === "result") {
        resultEvent = parseResultRecord(parsed)
        continue
      }
      collectContentFallbacks(parsed, fallbacks)
    } catch { /* skip non-JSON */ }
  }
  if (!resultEvent) {
    throw new Error("No result event found in stream-json output")
  }
  if (fallbacks.structuredOutput) {
    resultEvent.result = fallbacks.structuredOutput
  } else if (!resultEvent.result) {
    resultEvent.result = fallbacks.textParts.length > 0 ? fallbacks.textParts.join("") : ""
  }
  return resultEvent
}

export const runClaudeProcess = async (opts: ClaudeProcessOptions): Promise<ClaudeResult> => {
  const provider = opts.sandboxProvider ?? null
  if (provider?.syncRules) {
    await provider.syncRules(opts.networkAllowlist ?? [])
  }

  return new Promise((resolve, reject) => {
    const args = buildBaseArgs(opts)
    const cached = applyCachingArgs(args, opts)
    if (!cached) {
      args.push("--append-system-prompt", opts.systemPrompt)
    }
    assertSystemPromptFlagsExclusive(args)

    const spawnCmd = provider ? provider.command : "claude"
    const sandboxBuildOptions = provider
      ? {
          mode: opts.sandboxMode ?? "semi-locked" as const,
          extras: opts.sandboxExtras ?? { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
          additionalWritePaths: opts.additionalWritePaths,
        }
      : undefined
    const spawnArgs = provider && sandboxBuildOptions
      ? [...provider.buildArgs(opts.cwd, opts.networkAllowlist ?? [], sandboxBuildOptions), "claude", ...args]
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
        resolve(extractClaudeResultFromNdjson(stdoutData))
      } catch (err) {
        reject(new Error(`Failed to parse claude output: ${String(err)}`))
      }
    })

    proc.stdin?.write(opts.userPrompt)
    proc.stdin?.end()
  })
}
