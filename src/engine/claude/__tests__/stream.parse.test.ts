import { describe, it, expect } from "vitest"
import { parseStreamLine, createStreamHandler } from "../stream.parse"

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

describe("stream.parse", () => {
  describe("parseStreamLine", () => {
    it("parses legacy assistant text events", () => {
      const line = JSON.stringify({ type: "assistant", subtype: "text", text: "hello" })
      const event = parseStreamLine(line)
      expect(event).toEqual({ type: "text", text: "hello" })
    })

    it("parses current message-format assistant text events", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "hello from message" }],
        },
      })
      const event = parseStreamLine(line)
      expect(event).toEqual({ type: "text", text: "hello from message" })
    })

    it("concatenates multiple text content blocks", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "part one" },
            { type: "tool_use", id: "t1" },
            { type: "text", text: "part two" },
          ],
        },
      })
      const event = parseStreamLine(line)
      expect(event).toEqual({ type: "text", text: "part onepart two" })
    })

    it("returns other for message events with no text content", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1" }],
        },
      })
      expect(parseStreamLine(line)).toEqual({ type: "other" })
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

    it("parses legacy tool_use events", () => {
      const line = JSON.stringify({ type: "assistant", subtype: "tool_use", tool: "Read" })
      expect(parseStreamLine(line)).toEqual({ type: "tool_use", tool: "Read" })
    })

    it("parses current message-format tool_use events", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Bash" }],
        },
      })
      expect(parseStreamLine(line)).toEqual({ type: "tool_use", tool: "Bash", summary: undefined })
    })

    it("extracts tool input summary from current message-format tool_use", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }],
        },
      })
      const event = parseStreamLine(line)
      expect(event).toEqual({ type: "tool_use", tool: "Bash", summary: "npm test" })
    })

    it("extracts file_path for Read tool_use", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/src/index.ts" } }],
        },
      })
      const event = parseStreamLine(line)
      expect(event).toEqual({ type: "tool_use", tool: "Read", summary: "/src/index.ts" })
    })

    it("extracts pattern for Grep tool_use", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Grep", input: { pattern: "TODO", path: "src/" } }],
        },
      })
      const event = parseStreamLine(line)
      expect(event).toEqual({ type: "tool_use", tool: "Grep", summary: "TODO" })
    })

    it("truncates long summaries to 200 characters", () => {
      const longCommand = "a".repeat(250)
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: longCommand } }],
        },
      })
      const event = parseStreamLine(line)
      expect(event.type).toBe("tool_use")
      if (event.type === "tool_use") {
        expect(event.summary!.length).toBeLessThanOrEqual(200)
        expect(event.summary).toBe("a".repeat(199) + "…")
      }
    })

    it("returns empty summary for legacy tool_use format", () => {
      const line = JSON.stringify({ type: "assistant", subtype: "tool_use", tool: "Read" })
      const event = parseStreamLine(line)
      expect(event).toEqual({ type: "tool_use", tool: "Read" })
    })

    it("returns empty summary when tool input has no recognizable field", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Agent", input: { prompt: "do stuff" } }],
        },
      })
      const event = parseStreamLine(line)
      expect(event).toEqual({ type: "tool_use", tool: "Agent", summary: "do stuff" })
    })

    it("returns no summary when tool input has no recognizable field", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "CustomTool", input: { unknownField: "value" } }],
        },
      })
      const event = parseStreamLine(line)
      expect(event).toEqual({ type: "tool_use", tool: "CustomTool", summary: undefined })
    })

    it("takes only the first line of multi-line input", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "echo hello\necho world" } }],
        },
      })
      const event = parseStreamLine(line)
      expect(event).toEqual({ type: "tool_use", tool: "Bash", summary: "echo hello" })
    })

    it("prefers text over tool_use when both present in content", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me read that" },
            { type: "tool_use", id: "t1", name: "Read" },
          ],
        },
      })
      expect(parseStreamLine(line)).toEqual({ type: "text", text: "Let me read that" })
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
})
