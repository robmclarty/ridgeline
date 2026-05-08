import type { Engine, GenerateResult, StreamChunk } from "fascicle"
import type { ClaudeResult } from "../types.js"

export type RunClaudeAgents = Record<string, { description: string; prompt: string; model?: string }>

export type RunClaudeOptions = {
  readonly engine: Engine
  readonly model: string
  readonly system: string
  readonly prompt: string
  readonly allowedTools?: readonly string[]
  readonly sessionId?: string | null
  readonly outputJsonSchema?: string | null
  readonly buildDir?: string | null
  readonly abort?: AbortSignal
  readonly onChunk?: (chunk: StreamChunk) => void | Promise<void>
  readonly agents?: RunClaudeAgents
  /** Per-call deadline in ms; if elapsed, the call is aborted via AbortSignal. */
  readonly timeoutMs?: number
}

const extractSessionId = (result: GenerateResult<unknown>): string => {
  const reported = result.provider_reported as
    | { claude_cli?: { session_id?: string } }
    | undefined
  return reported?.claude_cli?.session_id ?? ""
}

const extractDurationMs = (result: GenerateResult<unknown>): number => {
  const reported = result.provider_reported as
    | { claude_cli?: { duration_ms?: number } }
    | undefined
  return reported?.claude_cli?.duration_ms ?? 0
}

const toClaudeUsage = (result: GenerateResult<unknown>): ClaudeResult["usage"] => ({
  inputTokens: result.usage.input_tokens,
  outputTokens: result.usage.output_tokens,
  cacheReadInputTokens: result.usage.cached_input_tokens ?? 0,
  cacheCreationInputTokens: result.usage.cache_write_tokens ?? 0,
})

export const toClaudeResult = (result: GenerateResult<unknown>): ClaudeResult => ({
  success: true,
  result: typeof result.content === "string" ? result.content : JSON.stringify(result.content),
  durationMs: extractDurationMs(result),
  costUsd: result.cost?.total_usd ?? 0,
  usage: toClaudeUsage(result),
  sessionId: extractSessionId(result),
})

const buildProviderOptions = (opts: RunClaudeOptions): Record<string, unknown> | undefined => {
  const claude_cli: Record<string, unknown> = {}
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    claude_cli.allowed_tools = [...opts.allowedTools]
  }
  if (opts.sessionId) {
    claude_cli.session_id = opts.sessionId
  }
  if (opts.outputJsonSchema) {
    claude_cli.output_json_schema = opts.outputJsonSchema
  }
  if (opts.agents !== undefined) {
    claude_cli.agents = opts.agents
  }
  if (Object.keys(claude_cli).length === 0) return undefined
  return { claude_cli }
}

const composeAbort = (opts: RunClaudeOptions): { signal?: AbortSignal; cancel: () => void } => {
  if (!opts.timeoutMs && !opts.abort) return { signal: opts.abort, cancel: () => {} }
  const controller = new AbortController()
  if (opts.abort) {
    if (opts.abort.aborted) controller.abort(opts.abort.reason)
    else opts.abort.addEventListener("abort", () => controller.abort(opts.abort?.reason), { once: true })
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  if (opts.timeoutMs) {
    timer = setTimeout(() => controller.abort(new Error(`Claude invocation timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs)
  }
  return {
    signal: controller.signal,
    cancel: () => { if (timer) clearTimeout(timer) },
  }
}

export const runClaudeOneShot = async (opts: RunClaudeOptions): Promise<ClaudeResult> => {
  const provider_options = buildProviderOptions(opts)
  const { signal, cancel } = composeAbort(opts)
  try {
    const result = await opts.engine.generate({
      model: opts.model,
      system: opts.system,
      prompt: opts.prompt,
      abort: signal,
      on_chunk: opts.onChunk,
      ...(provider_options ? { provider_options } : {}),
    })
    return toClaudeResult(result)
  } finally {
    cancel()
  }
}
