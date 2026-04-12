import { describe, it, expect } from "vitest"
import { normalizeQuestion, parseQAResponse } from "../qa-workflow"

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
