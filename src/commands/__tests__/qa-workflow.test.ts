import { describe, it, expect, vi, beforeEach } from "vitest"
import { normalizeQuestion, parseQAResponse, runQAIntake } from "../qa-workflow.js"
import type * as readline from "node:readline"

vi.mock("../../engine/claude.runner.js", () => ({
  runClaudeOneShot: vi.fn(),
}))

vi.mock("../../ui/claude-stream-display.js", () => ({
  createStreamDisplay: vi.fn(() => ({
    onChunk: vi.fn(),
    flush: vi.fn(),
  })),
}))

vi.mock("../../engine/engine.factory.js", () => ({
  makeRidgelineEngine: vi.fn(() => ({
    generate: vi.fn(),
    register_alias: vi.fn(),
    unregister_alias: vi.fn(),
    resolve_alias: vi.fn(),
    list_aliases: vi.fn(),
    register_price: vi.fn(),
    resolve_price: vi.fn(),
    list_prices: vi.fn(),
    dispose: vi.fn(async () => {}),
  })),
}))

import { runClaudeOneShot } from "../../engine/claude.runner.js"

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
    vi.mocked(runClaudeOneShot).mockResolvedValueOnce(
      makeClaudeResult({ ready: true, summary: "All clear" }),
    )

    const result = await runQAIntake(
      mockRl, "system", "user", { model: "test" }, 30000, "Analyzing...",
    )

    expect(result.qa.ready).toBe(true)
    expect(result.qa.summary).toBe("All clear")
    expect(runClaudeOneShot).toHaveBeenCalledTimes(1)
  })

  it("exits loop when questions array is empty", async () => {
    vi.mocked(runClaudeOneShot).mockResolvedValueOnce(
      makeClaudeResult({ ready: false, questions: [], summary: "Thinking..." }),
    )

    const result = await runQAIntake(
      mockRl, "system", "user", { model: "test" }, 30000, "Analyzing...",
    )

    expect(result.qa.ready).toBe(false)
    expect(runClaudeOneShot).toHaveBeenCalledTimes(1)
  })

  it("runs a single clarification round", async () => {
    vi.mocked(runClaudeOneShot)
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
    expect(runClaudeOneShot).toHaveBeenCalledTimes(2)

    const secondCall = vi.mocked(runClaudeOneShot).mock.calls[1][0]
    expect(secondCall.prompt).toContain("Q: What color?")
    expect(secondCall.prompt).toContain("A: Blue")
  })

  it("uses suggestedAnswer when user provides empty input", async () => {
    vi.mocked(runClaudeOneShot)
      .mockResolvedValueOnce(
        makeClaudeResult({
          ready: false,
          questions: [{ question: "Framework?", suggestedAnswer: "React" }],
        }),
      )
      .mockResolvedValueOnce(
        makeClaudeResult({ ready: true, summary: "Done" }),
      )

    answerQueue = [""]

    const result = await runQAIntake(
      mockRl, "system", "user", { model: "test" }, 30000, "Analyzing...",
    )

    expect(result.qa.ready).toBe(true)
    const secondCall = vi.mocked(runClaudeOneShot).mock.calls[1][0]
    expect(secondCall.prompt).toContain("A: React")
  })

  it("stops after MAX_CLARIFICATION_ROUNDS", async () => {
    const notReady = makeClaudeResult({
      ready: false,
      questions: ["More info?"],
      summary: "Still thinking",
    })
    vi.mocked(runClaudeOneShot)
      .mockResolvedValueOnce(notReady)
      .mockResolvedValueOnce(notReady)
      .mockResolvedValueOnce(notReady)
      .mockResolvedValueOnce(notReady)
      .mockResolvedValueOnce(notReady)

    answerQueue = ["a", "b", "c", "d"]

    const result = await runQAIntake(
      mockRl, "system", "user", { model: "test" }, 30000, "Analyzing...",
    )

    expect(runClaudeOneShot).toHaveBeenCalledTimes(5)
    expect(result.qa.ready).toBe(false)
  })

  it("propagates sessionId across rounds", async () => {
    vi.mocked(runClaudeOneShot)
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

    const secondClarification = vi.mocked(runClaudeOneShot).mock.calls[2][0]
    expect(secondClarification.sessionId).toBe("sess-b")
    expect(result.sessionId).toBe("sess-c")
  })
})
