import { ClaudeResult } from "../types"
import { startSpinner } from "../ui/spinner"

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "result"; result: ClaudeResult }
  | { type: "other" }

/**
 * Parse a single NDJSON line from `claude --output-format stream-json`.
 *
 * Relevant event shapes:
 * - `{"type":"assistant","subtype":"text","text":"..."}` — streamed model text
 * - `{"type":"result","result":"...","total_cost_usd":...}` — final result with usage
 */
export const parseStreamLine = (line: string): StreamEvent => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return { type: "other" }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { type: "other" }
  }

  if (parsed.type === "assistant" && parsed.subtype === "text") {
    const text = parsed.text
    if (typeof text === "string" && text.length > 0) {
      return { type: "text", text }
    }
    return { type: "other" }
  }

  if (parsed.type === "result") {
    return { type: "result", result: parseClaudeResult(parsed) }
  }

  return { type: "other" }
}

/**
 * Line-buffered chunk handler. Splits raw stdout chunks on newlines,
 * parses complete lines, and calls `onEvent` for each.
 */
export const createStreamHandler = (
  onEvent: (event: StreamEvent) => void,
): ((chunk: string) => void) => {
  let buffer = ""
  return (chunk: string) => {
    buffer += chunk
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (line.trim().length > 0) {
        onEvent(parseStreamLine(line))
      }
    }
  }
}

/**
 * Scan accumulated NDJSON stdout for the final `type: "result"` event
 * and return a parsed ClaudeResult.
 */
export const extractResult = (ndjsonStdout: string): ClaudeResult => {
  const lines = ndjsonStdout.trim().split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i])
      if (parsed.type === "result") {
        return parseClaudeResult(parsed)
      }
    } catch {
      // Not valid JSON, skip
    }
  }
  throw new Error("No result event found in stream-json output")
}

/**
 * Create an onStdout callback that streams assistant text to stdout
 * with blank line separators. Returns the callback and a flush function
 * to emit the trailing blank line after the invocation completes.
 */
export const createDisplayCallbacks = (): {
  onStdout: (chunk: string) => void
  flush: () => void
} => {
  let hasStreamedText = false
  const spinner = startSpinner()

  const handler = createStreamHandler((event) => {
    if (event.type === "text") {
      if (!hasStreamedText) {
        spinner.stop()
        process.stdout.write("\n")
        hasStreamedText = true
      }
      process.stdout.write(event.text)
    }
  })
  return {
    onStdout: handler,
    flush: () => {
      spinner.stop()
      if (hasStreamedText) {
        process.stdout.write("\n")
      }
    },
  }
}

const parseClaudeResult = (parsed: Record<string, unknown>): ClaudeResult => {
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
