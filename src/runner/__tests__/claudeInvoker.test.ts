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
import { invokeClaude, InvokeOptions } from "../claudeInvoker"

const baseOpts: InvokeOptions = {
  systemPrompt: "You are a test assistant",
  userPrompt: "Hello",
  model: "opus",
  cwd: "/tmp",
  verbose: false,
}

const sampleJsonOutput = JSON.stringify({
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
    it("spawns claude with correct arguments", () => {
      const promise = invokeClaude(baseOpts)

      expect(spawn).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining(["-p", "--output-format", "json", "--model", "opus"]),
        expect.objectContaining({ cwd: "/tmp" })
      )

      // Resolve the promise to avoid unhandled rejection
      const proc = vi.mocked(spawn).mock.results[0].value
      proc.stdout.emit("data", Buffer.from(sampleJsonOutput))
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
      proc.stdout.emit("data", Buffer.from(sampleJsonOutput))
      proc.emit("close", 0)

      return promise
    })

    it("pipes user prompt to stdin", () => {
      const promise = invokeClaude({ ...baseOpts, userPrompt: "Do something" })

      const proc = vi.mocked(spawn).mock.results[0].value
      expect(proc.stdin.write).toHaveBeenCalledWith("Do something")
      expect(proc.stdin.end).toHaveBeenCalled()

      proc.stdout.emit("data", Buffer.from(sampleJsonOutput))
      proc.emit("close", 0)

      return promise
    })

    it("parses JSON response correctly", async () => {
      const promise = invokeClaude(baseOpts)

      const proc = vi.mocked(spawn).mock.results[0].value
      proc.stdout.emit("data", Buffer.from(sampleJsonOutput))
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
      proc.stdout.emit("data", Buffer.from(sampleJsonOutput))
      proc.emit("close", 1)

      const result = await promise
      expect(result.success).toBe(true)
    })

    it("rejects on timeout", async () => {
      vi.useFakeTimers()

      const promise = invokeClaude({ ...baseOpts, timeoutMs: 5000 })

      const proc = vi.mocked(spawn).mock.results[0].value

      vi.advanceTimersByTime(5001)

      // The timeout handler calls proc.kill, then the close event fires
      proc.emit("close", null)

      await expect(promise).rejects.toThrow("timed out")

      vi.useRealTimers()
    })

    it("handles is_error flag in response", async () => {
      const errorOutput = JSON.stringify({
        is_error: true,
        result: "Something went wrong",
        duration_ms: 1000,
        total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 5 },
        session_id: "sess-err",
      })

      const promise = invokeClaude(baseOpts)
      const proc = vi.mocked(spawn).mock.results[0].value
      proc.stdout.emit("data", Buffer.from(errorOutput))
      proc.emit("close", 0)

      const result = await promise
      expect(result.success).toBe(false)
    })

    it("uses stream-json format in verbose mode", () => {
      const promise = invokeClaude({ ...baseOpts, verbose: true })

      expect(spawn).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining(["--output-format", "stream-json"]),
        expect.any(Object)
      )

      const proc = vi.mocked(spawn).mock.results[0].value
      // In stream mode, last line is the result JSON
      proc.stdout.emit("data", Buffer.from(
        '{"type":"assistant","subtype":"text","text":"hello"}\n' + sampleJsonOutput + "\n"
      ))
      proc.emit("close", 0)

      return promise
    })
  })
})
