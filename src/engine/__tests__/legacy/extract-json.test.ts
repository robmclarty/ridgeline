import { describe, it, expect } from "vitest"
import { extractJSON } from "../../ensemble.js"

describe("extractJSON", () => {
  it("parses raw JSON object", () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 })
  })

  it("parses raw JSON array", () => {
    expect(extractJSON("[1,2,3]")).toEqual([1, 2, 3])
  })

  it("trims surrounding whitespace before parsing", () => {
    expect(extractJSON('   \n{"a":1}\n  ')).toEqual({ a: 1 })
  })

  it("strips ```json fences", () => {
    const raw = '```json\n{"a":1}\n```'
    expect(extractJSON(raw)).toEqual({ a: 1 })
  })

  it("strips bare ``` fences", () => {
    const raw = '```\n{"a":2}\n```'
    expect(extractJSON(raw)).toEqual({ a: 2 })
  })

  it("extracts the outermost { ... } when surrounded by prose", () => {
    const raw = 'Here is the result: {"answer":42} — hope that helps.'
    expect(extractJSON(raw)).toEqual({ answer: 42 })
  })

  it("preserves nested objects when extracting outermost braces", () => {
    const raw = 'noise {"a":{"b":[1,2]}} trailing'
    expect(extractJSON(raw)).toEqual({ a: { b: [1, 2] } })
  })

  it("throws when no JSON object is present", () => {
    expect(() => extractJSON("totally not json here")).toThrow(/No valid JSON object found/)
  })

  it("throws when fence content is malformed and no outer braces match", () => {
    expect(() => extractJSON("```json\nnot really json\n```")).toThrow(/No valid JSON object found/)
  })
})
