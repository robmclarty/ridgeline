import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { parseStreamLine, createStreamHandler, extractResult, createDisplayCallbacks } from "../stream.decode"

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

describe("streamParser", () => {
  describe("parseStreamLine", () => {
    it("parses assistant text events", () => {
      const line = JSON.stringify({ type: "assistant", subtype: "text", text: "hello" })
      const event = parseStreamLine(line)
      expect(event).toEqual({ type: "text", text: "hello" })
    })

    it("parses result events", () => {
      const event = parseStreamLine(JSON.stringify(sampleResult))
      expect(event.type).toBe("result")
      if (event.type === "result") {
        expect(event.result.success).toBe(true)
        expect(event.result.result).toBe("All done")
        expect(event.result.costUsd).toBe(0.05)
        expect(event.result.sessionId).toBe("sess-123")
      }
    })

    it("returns other for non-text assistant events", () => {
      const line = JSON.stringify({ type: "assistant", subtype: "tool_use", tool: "Read" })
      expect(parseStreamLine(line)).toEqual({ type: "other" })
    })

    it("returns other for empty lines", () => {
      expect(parseStreamLine("")).toEqual({ type: "other" })
      expect(parseStreamLine("  ")).toEqual({ type: "other" })
    })

    it("returns other for invalid JSON", () => {
      expect(parseStreamLine("not json")).toEqual({ type: "other" })
    })

    it("returns other for unknown event types", () => {
      const line = JSON.stringify({ type: "system", message: "init" })
      expect(parseStreamLine(line)).toEqual({ type: "other" })
    })
  })

  describe("createStreamHandler", () => {
    it("buffers partial lines across chunks", () => {
      const events: string[] = []
      const handler = createStreamHandler((event) => {
        if (event.type === "text") events.push(event.text)
      })

      // First chunk: incomplete line
      handler('{"type":"assistant","subtype":"text","tex')
      expect(events).toHaveLength(0)

      // Second chunk: completes the line
      handler('t":"hello"}\n')
      expect(events).toEqual(["hello"])
    })

    it("handles multiple lines in one chunk", () => {
      const events: string[] = []
      const handler = createStreamHandler((event) => {
        if (event.type === "text") events.push(event.text)
      })

      handler(
        '{"type":"assistant","subtype":"text","text":"one"}\n' +
        '{"type":"assistant","subtype":"text","text":"two"}\n'
      )
      expect(events).toEqual(["one", "two"])
    })

    it("skips blank lines", () => {
      const events: string[] = []
      const handler = createStreamHandler((event) => {
        if (event.type === "text") events.push(event.text)
      })

      handler('{"type":"assistant","subtype":"text","text":"hi"}\n\n\n')
      expect(events).toEqual(["hi"])
    })
  })

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

    it("throws if no result event found", () => {
      const stdout = '{"type":"assistant","subtype":"text","text":"hi"}\n'
      expect(() => extractResult(stdout)).toThrow("No result event found")
    })
  })

  describe("createDisplayCallbacks", () => {
    let writeSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    })

    afterEach(() => {
      writeSpy.mockRestore()
    })

    it("emits leading blank line before first text", () => {
      const { onStdout } = createDisplayCallbacks()
      onStdout('{"type":"assistant","subtype":"text","text":"hello"}\n')

      expect(writeSpy).toHaveBeenCalledWith("\n")
      expect(writeSpy).toHaveBeenCalledWith("hello")
    })

    it("emits trailing blank line on flush if text was streamed", () => {
      const { onStdout, flush } = createDisplayCallbacks()
      onStdout('{"type":"assistant","subtype":"text","text":"hello"}\n')

      writeSpy.mockClear()
      flush()

      expect(writeSpy).toHaveBeenCalledWith("\n")
    })

    it("does not emit blank lines if no text was streamed", () => {
      const { flush } = createDisplayCallbacks()
      flush()

      expect(writeSpy).not.toHaveBeenCalled()
    })

    it("only emits leading blank line once", () => {
      const { onStdout } = createDisplayCallbacks()
      onStdout('{"type":"assistant","subtype":"text","text":"one"}\n')
      onStdout('{"type":"assistant","subtype":"text","text":"two"}\n')

      // \n (leading), "one", "two" — no second leading \n
      const newlineCalls = writeSpy.mock.calls.filter((c) => c[0] === "\n")
      expect(newlineCalls).toHaveLength(1)
    })
  })
})
