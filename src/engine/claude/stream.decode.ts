import { ClaudeResult } from "../../types"
import { startSpinner } from "../../ui/spinner"

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; tool: string }
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

  // Legacy format: {"type":"assistant","subtype":"text","text":"..."}
  if (parsed.type === "assistant" && parsed.subtype === "text") {
    const text = parsed.text
    if (typeof text === "string" && text.length > 0) {
      return { type: "text", text }
    }
    return { type: "other" }
  }

  // Legacy format: {"type":"assistant","subtype":"tool_use","tool":"Read"}
  if (parsed.type === "assistant" && parsed.subtype === "tool_use") {
    const tool = parsed.tool
    if (typeof tool === "string" && tool.length > 0) {
      return { type: "tool_use", tool }
    }
    return { type: "other" }
  }

  // Current format: {"type":"assistant","message":{"content":[...]}}
  if (parsed.type === "assistant" && parsed.message) {
    const message = parsed.message as Record<string, unknown>
    const content = message.content as Array<Record<string, unknown>> | undefined
    if (Array.isArray(content)) {
      const textParts = content
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("")
      if (textParts.length > 0) {
        return { type: "text", text: textParts }
      }

      // No text found — check for tool_use blocks
      const toolBlock = content.find((c) => c.type === "tool_use" && typeof c.name === "string")
      if (toolBlock) {
        return { type: "tool_use", tool: toolBlock.name as string }
      }
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

export interface DisplayCallbackOptions {
  /** Suppress fenced JSON blocks (```json ... ```) from display output. */
  suppressJsonBlock?: boolean
}

const RESUME_DEBOUNCE_MS = 200

/**
 * Create an onStdout callback that streams assistant text to stdout.
 * The spinner pauses while text is streaming and resumes after a
 * debounce period of inactivity, keeping it visible during tool-use pauses.
 * Returns the callback and a flush function to finalize output.
 */
export const createDisplayCallbacks = (opts?: DisplayCallbackOptions): {
  onStdout: (chunk: string) => void
  flush: () => void
} => {
  let hasStreamedText = false
  let lastCharWasNewline = true
  let jsonSuppressed = false
  let resumeTimer: ReturnType<typeof setTimeout> | null = null
  const spinner = startSpinner()

  const scheduleResume = () => {
    if (resumeTimer) clearTimeout(resumeTimer)
    resumeTimer = setTimeout(() => {
      resumeTimer = null
      if (!lastCharWasNewline) {
        process.stdout.write("\n")
        lastCharWasNewline = true
      }
      spinner.resume()
    }, RESUME_DEBOUNCE_MS)
  }

  const writeText = (text: string) => {
    if (opts?.suppressJsonBlock) {
      const lines = text.split("\n")
      const output: string[] = []
      for (const line of lines) {
        if (!jsonSuppressed && /^\s*```json\s*$/.test(line)) {
          jsonSuppressed = true
          continue
        }
        if (jsonSuppressed) continue
        output.push(line)
      }
      if (output.length === 0) return
      text = output.join("\n")
      if (text.length === 0) return
    }

    if (!lastCharWasNewline) {
      process.stdout.write("\n")
    }
    process.stdout.write(text)
    lastCharWasNewline = text.endsWith("\n")
  }

  const handler = createStreamHandler((event) => {
    if (event.type === "text") {
      if (!hasStreamedText) {
        hasStreamedText = true
      }
      spinner.pause()
      if (resumeTimer) clearTimeout(resumeTimer)
      writeText(event.text)
      scheduleResume()
    } else if (event.type === "tool_use") {
      spinner.setDetail(event.tool)
    }
  })
  return {
    onStdout: handler,
    flush: () => {
      if (resumeTimer) {
        clearTimeout(resumeTimer)
        resumeTimer = null
      }
      spinner.stop()
      if (hasStreamedText && !lastCharWasNewline) {
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
