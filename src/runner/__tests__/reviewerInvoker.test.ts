import { describe, it, expect } from "vitest"
import { parseVerdict } from "../reviewerInvoker"

describe("reviewerInvoker", () => {
  describe("parseVerdict", () => {
    it("parses a valid JSON verdict block", () => {
      const text = `
Some analysis here...

{
  "passed": true,
  "summary": "All criteria met",
  "criteriaResults": [
    { "criterion": 1, "passed": true, "notes": "Looks good" }
  ],
  "issues": [],
  "suggestions": ["Consider adding more tests"]
}

Some trailing text.`

      const verdict = parseVerdict(text)
      expect(verdict.passed).toBe(true)
      expect(verdict.summary).toBe("All criteria met")
      expect(verdict.criteriaResults).toHaveLength(1)
      expect(verdict.issues).toEqual([])
      expect(verdict.suggestions).toEqual(["Consider adding more tests"])
    })

    it("parses verdict from fenced code block", () => {
      const text = `
Here is my analysis:

\`\`\`json
{
  "passed": false,
  "summary": "Missing tests",
  "criteriaResults": [],
  "issues": ["No tests found"],
  "suggestions": []
}
\`\`\`
`

      const verdict = parseVerdict(text)
      expect(verdict.passed).toBe(false)
      expect(verdict.summary).toBe("Missing tests")
      expect(verdict.issues).toEqual(["No tests found"])
    })

    it("returns default failure when no JSON found", () => {
      const text = "This is just plain text with no JSON"

      const verdict = parseVerdict(text)
      expect(verdict.passed).toBe(false)
      expect(verdict.summary).toContain("Could not parse")
      expect(verdict.issues).toHaveLength(1)
    })

    it("returns default failure for invalid JSON", () => {
      const text = `
\`\`\`json
{ invalid json here }
\`\`\`
`
      const verdict = parseVerdict(text)
      expect(verdict.passed).toBe(false)
    })

    it("handles verdict with failed criteria", () => {
      const text = `
{
  "passed": false,
  "summary": "2 of 3 criteria met",
  "criteriaResults": [
    { "criterion": 1, "passed": true, "notes": "OK" },
    { "criterion": 2, "passed": false, "notes": "Missing error handling" },
    { "criterion": 3, "passed": true, "notes": "OK" }
  ],
  "issues": ["Error handling not implemented for edge case"],
  "suggestions": ["Add try-catch around API calls"]
}
`
      const verdict = parseVerdict(text)
      expect(verdict.passed).toBe(false)
      expect(verdict.criteriaResults).toHaveLength(3)
      expect(verdict.criteriaResults[1].passed).toBe(false)
      expect(verdict.issues).toHaveLength(1)
    })

    it("handles empty text", () => {
      const verdict = parseVerdict("")
      expect(verdict.passed).toBe(false)
    })
  })
})
