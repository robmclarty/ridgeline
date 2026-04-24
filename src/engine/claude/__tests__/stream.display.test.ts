import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createDisplayCallbacks } from "../stream.display"

describe("stream.display", () => {
  describe("createDisplayCallbacks", () => {
    let writeSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    })

    afterEach(() => {
      writeSpy.mockRestore()
    })

    it("writes first text without leading blank line", () => {
      const { onStdout } = createDisplayCallbacks()
      onStdout('{"type":"assistant","subtype":"text","text":"hello"}\n')

      expect(writeSpy).toHaveBeenCalledWith("hello")
      // No leading \n before first text
      const calls = writeSpy.mock.calls.map((c: [string]) => c[0])
      expect(calls[0]).toBe("hello")
    })

    it("emits trailing newline on flush if last text lacked one", () => {
      const { onStdout, flush } = createDisplayCallbacks()
      onStdout('{"type":"assistant","subtype":"text","text":"hello"}\n')

      writeSpy.mockClear()
      flush()

      expect(writeSpy).toHaveBeenCalledWith("\n")
    })

    it("does not emit trailing newline on flush if last text ended with newline", () => {
      const { onStdout, flush } = createDisplayCallbacks()
      onStdout('{"type":"assistant","subtype":"text","text":"hello\\n"}\n')

      writeSpy.mockClear()
      flush()

      expect(writeSpy).not.toHaveBeenCalled()
    })

    it("does not emit blank lines if no text was streamed", () => {
      const { flush } = createDisplayCallbacks()
      flush()

      expect(writeSpy).not.toHaveBeenCalled()
    })

    it("inserts newline between text events when prior text lacks trailing newline", () => {
      const { onStdout } = createDisplayCallbacks()
      onStdout('{"type":"assistant","subtype":"text","text":"one"}\n')
      onStdout('{"type":"assistant","subtype":"text","text":"two"}\n')

      const calls = writeSpy.mock.calls.map((c: [string]) => c[0])
      expect(calls).toEqual(["one", "\n", "two"])
    })

    it("does not insert extra newline between text events when prior text ends with newline", () => {
      const { onStdout } = createDisplayCallbacks()
      onStdout('{"type":"assistant","subtype":"text","text":"one\\n"}\n')
      onStdout('{"type":"assistant","subtype":"text","text":"two"}\n')

      const calls = writeSpy.mock.calls.map((c: [string]) => c[0])
      expect(calls).toEqual(["one\n", "two"])
    })

    it("wraps text in dim ANSI codes when dimText is set", () => {
      const { onStdout } = createDisplayCallbacks({ dimText: true })
      onStdout('{"type":"assistant","subtype":"text","text":"hello"}\n')

      const calls = writeSpy.mock.calls.map((c: [string]) => c[0])
      expect(calls[0]).toBe("\x1b[2mhello\x1b[0m")
    })

    it("writes plain text when dimText is not set", () => {
      const { onStdout } = createDisplayCallbacks()
      onStdout('{"type":"assistant","subtype":"text","text":"hello"}\n')

      const calls = writeSpy.mock.calls.map((c: [string]) => c[0])
      expect(calls[0]).toBe("hello")
    })

    it("suppresses fenced JSON blocks when suppressJsonBlock is set", () => {
      const { onStdout, flush } = createDisplayCallbacks({ suppressJsonBlock: true })
      onStdout('{"type":"assistant","subtype":"text","text":"review notes\\n"}\n')
      onStdout('{"type":"assistant","subtype":"text","text":"```json\\n"}\n')
      onStdout('{"type":"assistant","subtype":"text","text":"{\\"passed\\": true}\\n"}\n')
      onStdout('{"type":"assistant","subtype":"text","text":"```\\n"}\n')

      const calls = writeSpy.mock.calls.map((c: [string]) => c[0])
      expect(calls).toEqual(["review notes\n"])

      writeSpy.mockClear()
      flush()
    })

    it("does not suppress JSON blocks when suppressJsonBlock is not set", () => {
      const { onStdout } = createDisplayCallbacks()
      onStdout('{"type":"assistant","subtype":"text","text":"```json\\n"}\n')
      onStdout('{"type":"assistant","subtype":"text","text":"{\\"passed\\": true}\\n"}\n')

      const calls = writeSpy.mock.calls.map((c: [string]) => c[0])
      expect(calls).toContainEqual("```json\n")
    })

    it("prints tool call line to stderr when tool_use event has summary", () => {
      const origIsTTY = process.stderr.isTTY
      process.stderr.isTTY = true as never
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
      const { onStdout, flush } = createDisplayCallbacks()

      // Emit a tool_use event with summary
      const toolEvent = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }],
        },
      })
      onStdout(toolEvent + "\n")

      // The spinner's printAbove should have been called, which writes to stderr
      const stderrCalls = stderrSpy.mock.calls.map((c) => c[0] as string)
      const toolLine = stderrCalls.find((c) => c.includes("[Bash]") && c.includes("npm test"))
      expect(toolLine).toBeDefined()

      flush()
      stderrSpy.mockRestore()
      process.stderr.isTTY = origIsTTY as never
    })

    it("strips projectRoot prefix from tool summary when set", () => {
      const origIsTTY = process.stderr.isTTY
      process.stderr.isTTY = true as never
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
      const { onStdout, flush } = createDisplayCallbacks({ projectRoot: "/home/user/project" })

      const toolEvent = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/home/user/project/src/index.ts" } }],
        },
      })
      onStdout(toolEvent + "\n")

      const stderrCalls = stderrSpy.mock.calls.map((c) => c[0] as string)
      const toolLine = stderrCalls.find((c) => c.includes("[Read]"))
      expect(toolLine).toBeDefined()
      expect(toolLine).toContain("src/index.ts")
      expect(toolLine).not.toContain("/home/user/project")

      flush()
      stderrSpy.mockRestore()
      process.stderr.isTTY = origIsTTY as never
    })

    it("leaves tool summary unchanged when path is outside projectRoot", () => {
      const origIsTTY = process.stderr.isTTY
      process.stderr.isTTY = true as never
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
      const { onStdout, flush } = createDisplayCallbacks({ projectRoot: "/home/user/project" })

      const toolEvent = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/etc/config.json" } }],
        },
      })
      onStdout(toolEvent + "\n")

      const stderrCalls = stderrSpy.mock.calls.map((c) => c[0] as string)
      const toolLine = stderrCalls.find((c) => c.includes("[Read]"))
      expect(toolLine).toBeDefined()
      expect(toolLine).toContain("/etc/config.json")

      flush()
      stderrSpy.mockRestore()
      process.stderr.isTTY = origIsTTY as never
    })

    it("leaves tool summary unchanged when projectRoot is not set", () => {
      const origIsTTY = process.stderr.isTTY
      process.stderr.isTTY = true as never
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
      const { onStdout, flush } = createDisplayCallbacks()

      const toolEvent = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/home/user/project/src/index.ts" } }],
        },
      })
      onStdout(toolEvent + "\n")

      const stderrCalls = stderrSpy.mock.calls.map((c) => c[0] as string)
      const toolLine = stderrCalls.find((c) => c.includes("[Read]"))
      expect(toolLine).toBeDefined()
      expect(toolLine).toContain("/home/user/project/src/index.ts")

      flush()
      stderrSpy.mockRestore()
      process.stderr.isTTY = origIsTTY as never
    })

    it("strips projectRoot from Bash command summaries", () => {
      const origIsTTY = process.stderr.isTTY
      process.stderr.isTTY = true as never
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
      const { onStdout, flush } = createDisplayCallbacks({ projectRoot: "/home/user/project" })

      const toolEvent = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "cat /home/user/project/src/index.ts" } }],
        },
      })
      onStdout(toolEvent + "\n")

      const stderrCalls = stderrSpy.mock.calls.map((c) => c[0] as string)
      const toolLine = stderrCalls.find((c) => c.includes("[Bash]"))
      expect(toolLine).toBeDefined()
      expect(toolLine).toContain("src/index.ts")
      expect(toolLine).not.toContain("/home/user/project/")

      flush()
      stderrSpy.mockRestore()
      process.stderr.isTTY = origIsTTY as never
    })

    it("prints tool name only when no summary available", () => {
      const origIsTTY = process.stderr.isTTY
      process.stderr.isTTY = true as never
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
      const { onStdout, flush } = createDisplayCallbacks()

      // Legacy format — no summary
      const toolEvent = JSON.stringify({ type: "assistant", subtype: "tool_use", tool: "Read" })
      onStdout(toolEvent + "\n")

      const stderrCalls = stderrSpy.mock.calls.map((c) => c[0] as string)
      const toolLine = stderrCalls.find((c) => c.includes("[Read]"))
      expect(toolLine).toBeDefined()

      flush()
      stderrSpy.mockRestore()
      process.stderr.isTTY = origIsTTY as never
    })
  })
})
