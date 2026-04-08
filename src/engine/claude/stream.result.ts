import { ClaudeResult } from "../../types"
import { parseClaudeResult } from "./stream.parse"

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
