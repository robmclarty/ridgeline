import { ClaudeResult } from "../../types"
import { startSpinner } from "../../ui/spinner"

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; tool: string; summary?: string }
  | { type: "result"; result: ClaudeResult }
  | { type: "other" }

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

interface ContentFallbacks {
  textParts: string[]
  structuredOutput: string | null
}

const collectContentFallbacks = (parsed: Record<string, unknown>, acc: ContentFallbacks): void => {
  // Check for StructuredOutput tool_use in assistant messages
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

  // Legacy format text
  if (parsed.type === "assistant" && parsed.subtype === "text" && typeof parsed.text === "string") {
    acc.textParts.push(parsed.text as string)
  }
}

/**
 * Scan accumulated NDJSON stdout for the final `type: "result"` event
 * and return a parsed ClaudeResult.
 */
export const extractResult = (ndjsonStdout: string): ClaudeResult => {
  const lines = ndjsonStdout.trim().split("\n")

  // Collect fallback content for when result field is empty.
  // --json-schema uses a synthetic StructuredOutput tool_use whose input IS the JSON.
  // Text content is also collected as a secondary fallback.
  const fallbacks: ContentFallbacks = { textParts: [], structuredOutput: null }

  let resultEvent: ClaudeResult | null = null
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      if (parsed.type === "result") {
        resultEvent = parseClaudeResult(parsed)
        continue
      }
      collectContentFallbacks(parsed, fallbacks)
    } catch {
      // Not valid JSON, skip
    }
  }

  if (!resultEvent) {
    throw new Error("No result event found in stream-json output")
  }

  // Populate result from fallbacks: StructuredOutput first, then text content
  if (!resultEvent.result) {
    resultEvent.result = fallbacks.structuredOutput ?? (fallbacks.textParts.length > 0 ? fallbacks.textParts.join("") : "")
  }

  return resultEvent
}

interface DisplayCallbackOptions {
  /** Suppress fenced JSON blocks (```json ... ```) from display output. */
  suppressJsonBlock?: boolean
  /** When set, strip this prefix from tool-call file paths so the display shows relative paths. */
  projectRoot?: string
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
  let lastEventWasTool = false
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
      if (lastEventWasTool) {
        process.stdout.write("\n")
        lastEventWasTool = false
      }
      writeText(event.text)
      scheduleResume()
    } else if (event.type === "tool_use") {
      let summary = event.summary
      if (summary && opts?.projectRoot) {
        const root = opts.projectRoot.endsWith("/") ? opts.projectRoot : opts.projectRoot + "/"
        summary = summary.replaceAll(root, "")
      }
      const line = summary
        ? `[${event.tool}] ${summary}`
        : `[${event.tool}]`
      spinner.printAbove(line)
      spinner.setDetail(event.tool)
      lastEventWasTool = true
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
