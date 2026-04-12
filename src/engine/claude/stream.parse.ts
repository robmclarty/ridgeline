import { parseClaudeResult, type StreamEvent } from "./stream.types"

/**
 * Parse a single NDJSON line from `claude --output-format stream-json`.
 *
 * Relevant event shapes:
 * - `{"type":"assistant","subtype":"text","text":"..."}` — streamed model text
 * - `{"type":"result","result":"...","total_cost_usd":...}` — final result with usage
 */
const MAX_SUMMARY_LEN = 200

const summarizeToolInput = (input: Record<string, unknown>): string | undefined => {
  // Pick the most informative field per tool type
  const raw =
    input.command ??        // Bash
    input.file_path ??      // Read, Write, Edit
    input.pattern ??        // Grep, Glob
    input.prompt            // Agent

  if (typeof raw !== "string" || raw.length === 0) return undefined

  // Take first line only
  const firstLine = raw.split("\n")[0]
  if (firstLine.length <= MAX_SUMMARY_LEN) return firstLine
  return firstLine.slice(0, MAX_SUMMARY_LEN - 1) + "…"
}

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
        const summary = toolBlock.input
          ? summarizeToolInput(toolBlock.input as Record<string, unknown>)
          : undefined
        return { type: "tool_use", tool: toolBlock.name as string, summary }
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
