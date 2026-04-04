import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock child_process before importing
vi.mock("node:child_process", () => {
  const EventEmitter = require("node:events")

  const createMockProc = () => {
    const proc = new EventEmitter()
    proc.stdin = { write: vi.fn(), end: vi.fn() }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn()
    return proc
  }

  return {
    spawn: vi.fn(() => createMockProc()),
  }
})

import { spawn } from "node:child_process"
import { invokeClaude, InvokeOptions } from "../claude.exec"

const baseOpts: InvokeOptions = {
  systemPrompt: "You are a test assistant",
  userPrompt: "Hello",
  model: "opus",
  cwd: "/tmp",
}

const sampleResultLine = JSON.stringify({
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
})

describe("claudeInvoker", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("invokeClaude", () => {
    it("always uses stream-json format", () => {
      const promise = invokeClaude(baseOpts)

      expect(spawn).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining(["-p", "--output-format", "stream-json", "--model", "opus"]),
        expect.objectContaining({ cwd: "/tmp" })
      )

      const proc = vi.mocked(spawn).mock.results[0].value
      proc.stdout.emit("data", Buffer.from(sampleResultLine + "\n"))
      proc.emit("close", 0)

      return promise
    })

    it("passes allowed tools when specified", () => {
      const promise = invokeClaude({ ...baseOpts, allowedTools: ["Read", "Write"] })

      expect(spawn).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining(["--allowedTools", "Read,Write"]),
        expect.any(Object)
      )

      const proc = vi.mocked(spawn).mock.results[0].value
      proc.stdout.emit("data", Buffer.from(sampleResultLine + "\n"))
      proc.emit("close", 0)

      return promise
    })

    it("pipes user prompt to stdin", () => {
      const promise = invokeClaude({ ...baseOpts, userPrompt: "Do something" })

      const proc = vi.mocked(spawn).mock.results[0].value
      expect(proc.stdin.write).toHaveBeenCalledWith("Do something")
      expect(proc.stdin.end).toHaveBeenCalled()

      proc.stdout.emit("data", Buffer.from(sampleResultLine + "\n"))
      proc.emit("close", 0)

      return promise
    })

    it("parses stream-json result correctly", async () => {
      const promise = invokeClaude(baseOpts)

      const proc = vi.mocked(spawn).mock.results[0].value
      proc.stdout.emit("data", Buffer.from(
        '{"type":"assistant","subtype":"text","text":"hello"}\n' +
        sampleResultLine + "\n"
      ))
      proc.emit("close", 0)

      const result = await promise
      expect(result.success).toBe(true)
      expect(result.result).toBe("All done")
      expect(result.durationMs).toBe(3000)
      expect(result.costUsd).toBe(0.05)
      expect(result.usage.inputTokens).toBe(100)
      expect(result.usage.outputTokens).toBe(50)
      expect(result.sessionId).toBe("sess-123")
    })

    it("calls onStdout callback with raw chunks", async () => {
      const onStdout = vi.fn()
      const promise = invokeClaude({ ...baseOpts, onStdout })

      const proc = vi.mocked(spawn).mock.results[0].value
      const chunk = sampleResultLine + "\n"
      proc.stdout.emit("data", Buffer.from(chunk))
      proc.emit("close", 0)

      await promise
      expect(onStdout).toHaveBeenCalledWith(chunk)
    })

    it("rejects on non-zero exit with no stdout", async () => {
      const promise = invokeClaude(baseOpts)

      const proc = vi.mocked(spawn).mock.results[0].value
      proc.stderr.emit("data", Buffer.from("error output"))
      proc.emit("close", 1)

      await expect(promise).rejects.toThrow("claude exited with code 1")
    })

    it("still resolves if exit code is non-zero but stdout has content", async () => {
      const promise = invokeClaude(baseOpts)

      const proc = vi.mocked(spawn).mock.results[0].value
      proc.stdout.emit("data", Buffer.from(sampleResultLine + "\n"))
      proc.emit("close", 1)

      const result = await promise
      expect(result.success).toBe(true)
    })

    it("rejects on timeout", async () => {
      vi.useFakeTimers()

      const promise = invokeClaude({
        ...baseOpts,
        timeoutMs: 5000,
        startupTimeoutMs: 60_000, // prevent startup stall from firing first
      })

      const proc = vi.mocked(spawn).mock.results[0].value

      vi.advanceTimersByTime(5001)

      // The timeout handler calls proc.kill, then the close event fires
      proc.emit("close", null)

      await expect(promise).rejects.toThrow("timed out")

      vi.useRealTimers()
    })

    it("rejects on startup stall when no output arrives", async () => {
      vi.useFakeTimers()

      const promise = invokeClaude({
        ...baseOpts,
        startupTimeoutMs: 3000,
      })

      const proc = vi.mocked(spawn).mock.results[0].value

      vi.advanceTimersByTime(3001)

      // Stall handler kills proc, then close fires
      proc.emit("close", null)

      await expect(promise).rejects.toThrow("startup timeout")

      vi.useRealTimers()
    })

    it("rejects on stall when output stops arriving", async () => {
      vi.useFakeTimers()

      const promise = invokeClaude({
        ...baseOpts,
        startupTimeoutMs: 1000,
        stallTimeoutMs: 2000,
      })

      const proc = vi.mocked(spawn).mock.results[0].value

      // First output arrives at 500ms — resets from startup to stall timer
      vi.advanceTimersByTime(500)
      proc.stdout.emit("data", Buffer.from('{"type":"assistant","subtype":"text","text":"hi"}\n'))

      // Now 2000ms of silence triggers stall
      vi.advanceTimersByTime(2001)

      proc.emit("close", null)

      await expect(promise).rejects.toThrow("stall timeout")

      vi.useRealTimers()
    })

    it("does not stall when output keeps arriving", async () => {
      vi.useFakeTimers()

      const promise = invokeClaude({
        ...baseOpts,
        startupTimeoutMs: 1000,
        stallTimeoutMs: 2000,
      })

      const proc = vi.mocked(spawn).mock.results[0].value

      // Activity every 1.5s — never reaches 2s stall threshold
      vi.advanceTimersByTime(500)
      proc.stdout.emit("data", Buffer.from('{"type":"assistant","subtype":"text","text":"a"}\n'))
      vi.advanceTimersByTime(1500)
      proc.stdout.emit("data", Buffer.from('{"type":"assistant","subtype":"text","text":"b"}\n'))
      vi.advanceTimersByTime(1500)
      proc.stdout.emit("data", Buffer.from(sampleResultLine + "\n"))

      proc.emit("close", 0)

      const result = await promise
      expect(result.success).toBe(true)

      vi.useRealTimers()
    })

    it("stderr activity does not reset the stall timer", async () => {
      vi.useFakeTimers()

      const promise = invokeClaude({
        ...baseOpts,
        startupTimeoutMs: 1000,
        stallTimeoutMs: 2000,
      })

      const proc = vi.mocked(spawn).mock.results[0].value

      // stderr at 500ms — should NOT reset the startup timer
      vi.advanceTimersByTime(500)
      proc.stderr.emit("data", Buffer.from("some log"))

      // Startup timer fires at 1000ms despite stderr activity
      vi.advanceTimersByTime(501)

      proc.emit("close", null)

      await expect(promise).rejects.toThrow("startup timeout")

      vi.useRealTimers()
    })

    it("handles is_error flag in response", async () => {
      const errorOutput = JSON.stringify({
        type: "result",
        is_error: true,
        result: "Something went wrong",
        duration_ms: 1000,
        total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 5 },
        session_id: "sess-err",
      })

      const promise = invokeClaude(baseOpts)
      const proc = vi.mocked(spawn).mock.results[0].value
      proc.stdout.emit("data", Buffer.from(errorOutput + "\n"))
      proc.emit("close", 0)

      const result = await promise
      expect(result.success).toBe(false)
    })

    it("spawns via sandbox provider when one is given", () => {
      const mockProvider = {
        name: "bwrap" as const,
        command: "bwrap",
        buildArgs: vi.fn(() => ["--ro-bind", "/", "/", "--unshare-net", "--die-with-parent"]),
      }

      const promise = invokeClaude({
        ...baseOpts,
        sandboxProvider: mockProvider,
        networkAllowlist: ["registry.npmjs.org"],
      })

      expect(mockProvider.buildArgs).toHaveBeenCalledWith("/tmp", ["registry.npmjs.org"], undefined)
      expect(spawn).toHaveBeenCalledWith(
        "bwrap",
        expect.arrayContaining(["--ro-bind", "--unshare-net", "claude"]),
        expect.objectContaining({ cwd: "/tmp" })
      )

      const proc = vi.mocked(spawn).mock.results[0].value
      proc.stdout.emit("data", Buffer.from(sampleResultLine + "\n"))
      proc.emit("close", 0)

      return promise
    })

    it("spawns claude directly when no sandbox provider", () => {
      const promise = invokeClaude({ ...baseOpts, sandboxProvider: null })

      expect(spawn).toHaveBeenCalledWith(
        "claude",
        expect.any(Array),
        expect.any(Object)
      )

      const proc = vi.mocked(spawn).mock.results[0].value
      proc.stdout.emit("data", Buffer.from(sampleResultLine + "\n"))
      proc.emit("close", 0)

      return promise
    })

    it("spawns claude directly when sandboxProvider is undefined", () => {
      const promise = invokeClaude(baseOpts)

      expect(spawn).toHaveBeenCalledWith(
        "claude",
        expect.any(Array),
        expect.any(Object)
      )

      const proc = vi.mocked(spawn).mock.results[0].value
      proc.stdout.emit("data", Buffer.from(sampleResultLine + "\n"))
      proc.emit("close", 0)

      return promise
    })
  })
})
