import { ClaudeResult } from "../../types.js"

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; tool: string; summary?: string }
  | { type: "result"; result: ClaudeResult }
  | { type: "other" }

export const parseClaudeResult = (parsed: Record<string, unknown>): ClaudeResult => {
  const result = parsed.result
  return {
    success: !parsed.is_error,
    result: typeof result === "string"
      ? result
      : (result != null ? JSON.stringify(result) : ""),
    durationMs: (parsed.duration_ms as number) ?? 0,
    costUsd: (parsed.total_cost_usd as number) ?? 0,
    usage: {
      inputTokens: (parsed as Record<string, Record<string, number>>).usage?.input_tokens ?? 0,
      outputTokens: (parsed as Record<string, Record<string, number>>).usage?.output_tokens ?? 0,
      cacheReadInputTokens: (parsed as Record<string, Record<string, number>>).usage?.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: (parsed as Record<string, Record<string, number>>).usage?.cache_creation_input_tokens ?? 0,
    },
    sessionId: (parsed.session_id as string) ?? "",
  }
}
