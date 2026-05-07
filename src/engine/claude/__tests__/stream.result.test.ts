import { describe, it, expect } from "vitest"
import { extractResult } from "../stream.result.js"

const sampleResult = {
  type: "result",
  is_error: false,
  result: "All done",
  duration_ms: 3000,
  total_cost_usd: 0.05,
  usage: {
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 5,
  },
  session_id: "sess-123",
}

describe("stream.result", () => {
  describe("extractResult", () => {
    it("extracts result from NDJSON stdout", () => {
      const stdout =
        '{"type":"assistant","subtype":"text","text":"working..."}\n' +
        JSON.stringify(sampleResult) + "\n"

      const result = extractResult(stdout)
      expect(result.success).toBe(true)
      expect(result.result).toBe("All done")
      expect(result.durationMs).toBe(3000)
      expect(result.costUsd).toBe(0.05)
      expect(result.usage.inputTokens).toBe(100)
      expect(result.usage.outputTokens).toBe(50)
      expect(result.usage.cacheReadInputTokens).toBe(10)
      expect(result.usage.cacheCreationInputTokens).toBe(5)
      expect(result.sessionId).toBe("sess-123")
    })

    it("finds result even if not the last line", () => {
      const stdout =
        JSON.stringify(sampleResult) + "\n" +
        '{"type":"other","data":"trailing"}\n'

      // Should still find the result by scanning backward
      const result = extractResult(stdout)
      expect(result.result).toBe("All done")
    })

    it("uses assistant text as fallback when result field is empty", () => {
      const emptyResult = { ...sampleResult, result: "" }
      const stdout =
        '{"type":"assistant","subtype":"text","text":"{\\"answer\\":\\"hello\\"}"}\n' +
        JSON.stringify(emptyResult) + "\n"

      const result = extractResult(stdout)
      expect(result.result).toBe('{"answer":"hello"}')
      expect(result.costUsd).toBe(0.05)
    })

    it("extracts StructuredOutput tool_use input when result is empty", () => {
      const emptyResult = { ...sampleResult, result: "" }
      const assistantMsg = {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "planning..." },
            {
              type: "tool_use",
              name: "StructuredOutput",
              input: { perspective: "simplicity", summary: "One phase", phases: [], tradeoffs: "none" },
            },
          ],
        },
      }
      const stdout =
        JSON.stringify(assistantMsg) + "\n" +
        JSON.stringify(emptyResult) + "\n"

      const result = extractResult(stdout)
      const parsed = JSON.parse(result.result)
      expect(parsed.perspective).toBe("simplicity")
      expect(parsed.summary).toBe("One phase")
    })

    it("prefers StructuredOutput over text fallback", () => {
      const emptyResult = { ...sampleResult, result: "" }
      const assistantText = { type: "assistant", subtype: "text", text: "some prose" }
      const assistantMsg = {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "StructuredOutput", input: { answer: 42 } },
          ],
        },
      }
      const stdout =
        JSON.stringify(assistantText) + "\n" +
        JSON.stringify(assistantMsg) + "\n" +
        JSON.stringify(emptyResult) + "\n"

      const result = extractResult(stdout)
      expect(JSON.parse(result.result)).toEqual({ answer: 42 })
    })

    it("preserves result field when it has content and no StructuredOutput", () => {
      const stdout =
        '{"type":"assistant","subtype":"text","text":"streamed text"}\n' +
        JSON.stringify(sampleResult) + "\n"

      const result = extractResult(stdout)
      expect(result.result).toBe("All done")
    })

    it("prefers StructuredOutput over non-empty result field", () => {
      const resultWithProse = { ...sampleResult, result: "Here is a summary of the plan..." }
      const assistantMsg = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "StructuredOutput",
              input: { perspective: "velocity", summary: "Fast build", phases: [], tradeoffs: "none" },
            },
          ],
        },
      }
      const stdout =
        JSON.stringify(assistantMsg) + "\n" +
        JSON.stringify(resultWithProse) + "\n"

      const result = extractResult(stdout)
      const parsed = JSON.parse(result.result)
      expect(parsed.perspective).toBe("velocity")
      expect(parsed.summary).toBe("Fast build")
    })

    it("throws if no result event found", () => {
      const stdout = '{"type":"assistant","subtype":"text","text":"hi"}\n'
      expect(() => extractResult(stdout)).toThrow("No result event found")
    })
  })
})
