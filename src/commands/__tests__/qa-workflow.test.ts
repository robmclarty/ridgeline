import { describe, it, expect, vi, beforeEach } from "vitest"
import { normalizeQuestion, parseQAResponse, runQAIntake } from "../qa-workflow.js"
import type * as readline from "node:readline"

vi.mock("../../engine/claude/claude.exec.js", () => ({
  invokeClaude: vi.fn(),
}))

vi.mock("../../engine/claude/stream.display.js", () => ({
  createDisplayCallbacks: vi.fn(() => ({
    onStdout: vi.fn(),
    flush: vi.fn(),
  })),
}))

import { invokeClaude } from "../../engine/claude/claude.exec.js"

describe("normalizeQuestion", () => {
  it("wraps a plain string into a QAQuestion", () => {
    expect(normalizeQuestion("What color?")).toEqual({ question: "What color?" })
  })

  it("passes through a QAQuestion object unchanged", () => {
    const q = { question: "What color?", suggestedAnswer: "Blue" }
    expect(normalizeQuestion(q)).toBe(q)
  })
})

describe("parseQAResponse", () => {
  it("parses valid JSON into a QAResponse", () => {
    const input = JSON.stringify({ ready: true, summary: "Done" })
    expect(parseQAResponse(input)).toEqual({ ready: true, summary: "Done" })
  })

  it("parses QAResponse with questions", () => {
    const input = JSON.stringify({
      ready: false,
      questions: [{ question: "What color?" }],
      summary: "Need more info",
    })
    const result = parseQAResponse(input)
    expect(result.ready).toBe(false)
    expect(result.questions).toHaveLength(1)
  })

  it("returns ready:true with raw text as summary for invalid JSON", () => {
    const result = parseQAResponse("This is not JSON")
    expect(result.ready).toBe(true)
    expect(result.summary).toBe("This is not JSON")
  })

  it("returns ready:true with raw text for malformed JSON", () => {
    const result = parseQAResponse("{bad json{{{")
    expect(result.ready).toBe(true)
    expect(result.summary).toBe("{bad json{{{")
  })
})

describe("runQAIntake", () => {
  const makeClaudeResult = (response: unknown) => ({
    result: typeof response === "string" ? response : JSON.stringify(response),
    sessionId: "sess-1",
    costUsd: 0.01,
    durationMs: 1000,
    success: true,
    usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  })

  let mockRl: readline.Interface
  let answerQueue: string[]

  beforeEach(() => {
    vi.clearAllMocks()
    answerQueue = []
    mockRl = {
      question: (_prompt: string, cb: (answer: string) => void) => {
        cb(answerQueue.shift() ?? "")
      },
      close: vi.fn(),
    } as unknown as readline.Interface
  })

  it("returns immediately when initial response is ready", async () => {
    vi.mocked(invokeClaude).mockResolvedValueOnce(
      makeClaudeResult({ ready: true, summary: "All clear" }),
    )

    const result = await runQAIntake(
      mockRl, "system", "user", { model: "test" }, 30000, "Analyzing...",
    )

    expect(result.qa.ready).toBe(true)
    expect(result.qa.summary).toBe("All clear")
    expect(invokeClaude).toHaveBeenCalledTimes(1)
  })

  it("exits loop when questions array is empty", async () => {
    vi.mocked(invokeClaude).mockResolvedValueOnce(
      makeClaudeResult({ ready: false, questions: [], summary: "Thinking..." }),
    )

    const result = await runQAIntake(
      mockRl, "system", "user", { model: "test" }, 30000, "Analyzing...",
    )

    expect(result.qa.ready).toBe(false)
    expect(invokeClaude).toHaveBeenCalledTimes(1) // no clarification call
  })

  it("runs a single clarification round", async () => {
    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(
        makeClaudeResult({
          ready: false,
          questions: ["What color?"],
          summary: "Need details",
        }),
      )
      .mockResolvedValueOnce({
        ...makeClaudeResult({ ready: true, summary: "Got it" }),
        sessionId: "sess-2",
      })

    answerQueue = ["Blue"]

    const result = await runQAIntake(
      mockRl, "system", "user", { model: "test" }, 30000, "Analyzing...",
    )

    expect(result.qa.ready).toBe(true)
    expect(result.sessionId).toBe("sess-2")
    expect(invokeClaude).toHaveBeenCalledTimes(2)

    // Verify answers are passed in the second call
    const secondCall = vi.mocked(invokeClaude).mock.calls[1][0]
    expect(secondCall.userPrompt).toContain("Q: What color?")
    expect(secondCall.userPrompt).toContain("A: Blue")
  })

  it("uses suggestedAnswer when user provides empty input", async () => {
    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(
        makeClaudeResult({
          ready: false,
          questions: [{ question: "Framework?", suggestedAnswer: "React" }],
        }),
      )
      .mockResolvedValueOnce(
        makeClaudeResult({ ready: true, summary: "Done" }),
      )

    answerQueue = [""] // empty — should fall back to suggested

    const result = await runQAIntake(
      mockRl, "system", "user", { model: "test" }, 30000, "Analyzing...",
    )

    expect(result.qa.ready).toBe(true)
    const secondCall = vi.mocked(invokeClaude).mock.calls[1][0]
    expect(secondCall.userPrompt).toContain("A: React")
  })

  it("stops after MAX_CLARIFICATION_ROUNDS", async () => {
    // Return "not ready" with questions every round
    const notReady = makeClaudeResult({
      ready: false,
      questions: ["More info?"],
      summary: "Still thinking",
    })
    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(notReady) // initial intake
      .mockResolvedValueOnce(notReady) // round 0 clarification
      .mockResolvedValueOnce(notReady) // round 1
      .mockResolvedValueOnce(notReady) // round 2
      .mockResolvedValueOnce(notReady) // round 3

    answerQueue = ["a", "b", "c", "d"]

    const result = await runQAIntake(
      mockRl, "system", "user", { model: "test" }, 30000, "Analyzing...",
    )

    // 1 initial + 4 clarification rounds = 5 calls
    expect(invokeClaude).toHaveBeenCalledTimes(5)
    expect(result.qa.ready).toBe(false)
  })

  it("propagates sessionId across rounds", async () => {
    vi.mocked(invokeClaude)
      .mockResolvedValueOnce({
        ...makeClaudeResult({ ready: false, questions: ["Q1?"] }),
        sessionId: "sess-a",
      })
      .mockResolvedValueOnce({
        ...makeClaudeResult({ ready: false, questions: ["Q2?"] }),
        sessionId: "sess-b",
      })
      .mockResolvedValueOnce({
        ...makeClaudeResult({ ready: true, summary: "Done" }),
        sessionId: "sess-c",
      })

    answerQueue = ["answer1", "answer2"]

    const result = await runQAIntake(
      mockRl, "system", "user", { model: "test" }, 30000, "Analyzing...",
    )

    // Second clarification call should use sessionId from first clarification
    const secondClarification = vi.mocked(invokeClaude).mock.calls[2][0]
    expect(secondClarification.sessionId).toBe("sess-b")
    expect(result.sessionId).toBe("sess-c")
  })
})
