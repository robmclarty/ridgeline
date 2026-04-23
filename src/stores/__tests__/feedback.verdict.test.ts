import { describe, it, expect } from "vitest"
import {
  parseVerdict,
  formatIssue,
  generateFeedback,
} from "../feedback.verdict"

describe("feedback.verdict", () => {
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
  "suggestions": [{ "description": "Consider adding more tests", "severity": "suggestion" }]
}

Some trailing text.`

      const verdict = parseVerdict(text)
      expect(verdict.passed).toBe(true)
      expect(verdict.summary).toBe("All criteria met")
      expect(verdict.criteriaResults).toHaveLength(1)
      expect(verdict.issues).toEqual([])
      expect(verdict.suggestions).toHaveLength(1)
      expect(verdict.suggestions[0].description).toBe("Consider adding more tests")
    })

    it("parses verdict from fenced code block", () => {
      const text = `
Here is my analysis:

\`\`\`json
{
  "passed": false,
  "summary": "Missing tests",
  "criteriaResults": [],
  "issues": [{ "description": "No tests found", "severity": "blocking" }],
  "suggestions": []
}
\`\`\`
`

      const verdict = parseVerdict(text)
      expect(verdict.passed).toBe(false)
      expect(verdict.summary).toBe("Missing tests")
      expect(verdict.issues).toHaveLength(1)
      expect(verdict.issues[0].description).toBe("No tests found")
      expect(verdict.issues[0].severity).toBe("blocking")
    })

    it("normalizes string issues to structured form", () => {
      const text = `{
  "passed": false,
  "summary": "Failed",
  "criteriaResults": [],
  "issues": ["Error handling not implemented"],
  "suggestions": ["Add try-catch"]
}`

      const verdict = parseVerdict(text)
      expect(verdict.issues).toHaveLength(1)
      expect(verdict.issues[0].description).toBe("Error handling not implemented")
      expect(verdict.issues[0].severity).toBe("blocking")
      expect(verdict.suggestions[0].description).toBe("Add try-catch")
      expect(verdict.suggestions[0].severity).toBe("suggestion")
    })

    it("parses structured issues with all fields", () => {
      const text = `{
  "passed": false,
  "summary": "Criterion 2 fails",
  "criteriaResults": [
    { "criterion": 1, "passed": true, "notes": "OK" },
    { "criterion": 2, "passed": false, "notes": "Returns empty array" }
  ],
  "issues": [{
    "criterion": 2,
    "description": "GET /api/users returns empty array",
    "file": "src/test/setup.ts",
    "severity": "blocking",
    "requiredState": "Test setup must invoke seed script"
  }],
  "suggestions": []
}`

      const verdict = parseVerdict(text)
      expect(verdict.passed).toBe(false)
      expect(verdict.issues[0].criterion).toBe(2)
      expect(verdict.issues[0].file).toBe("src/test/setup.ts")
      expect(verdict.issues[0].requiredState).toBe("Test setup must invoke seed script")
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
  "issues": [{ "description": "Error handling not implemented for edge case", "severity": "blocking" }],
  "suggestions": [{ "description": "Add try-catch around API calls", "severity": "suggestion" }]
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

    it("finds JSON after non-JSON text with braces", () => {
      const text = `
[review:01-core-cli] Starting review
Checking criterion 1... {some log output}
Checking criterion 2...

{
  "passed": true,
  "summary": "All good",
  "criteriaResults": [{ "criterion": 1, "passed": true, "notes": "OK" }],
  "issues": [],
  "suggestions": []
}`

      const verdict = parseVerdict(text)
      expect(verdict.passed).toBe(true)
    })
  })

  describe("formatIssue", () => {
    it("formats issue without file", () => {
      expect(formatIssue({ description: "Missing tests", severity: "blocking" }))
        .toBe("Missing tests")
    })

    it("formats issue with file", () => {
      expect(formatIssue({ description: "Missing tests", file: "src/index.ts", severity: "blocking" }))
        .toBe("src/index.ts: Missing tests")
    })
  })

  describe("generateFeedback", () => {
    it("generates feedback markdown from a failed verdict", () => {
      const feedback = generateFeedback("01-core-cli", {
        passed: false,
        summary: "1 of 2 criteria met",
        criteriaResults: [
          { criterion: 1, passed: true, notes: "CLI runs correctly" },
          { criterion: 2, passed: false, notes: "No --help flag implemented" },
        ],
        issues: [{
          criterion: 2,
          description: "Running `excuse --help` exits with code 1",
          file: "src/cli.ts",
          severity: "blocking",
          requiredState: "--help flag must print usage and exit 0",
        }],
        suggestions: [],
        sensorFindings: [],
      })

      expect(feedback).toContain("# Reviewer Feedback: Phase 01-core-cli")
      expect(feedback).toContain("### Criterion 2")
      expect(feedback).toContain("**Evidence:** No --help flag implemented")
      expect(feedback).toContain("**Required state:** --help flag must print usage and exit 0")
      expect(feedback).toContain("## What Passed")
      expect(feedback).toContain("Criterion 1: CLI runs correctly")
    })

    it("generates minimal feedback when no criteria details", () => {
      const feedback = generateFeedback("01-core-cli", {
        passed: false,
        summary: "Could not parse",
        criteriaResults: [],
        issues: [{ description: "Unparseable output", severity: "blocking" }],
        suggestions: [],
        sensorFindings: [],
      })

      expect(feedback).toContain("## Issues")
      expect(feedback).toContain("Unparseable output")
      expect(feedback).not.toContain("## Failed Criteria")
      expect(feedback).not.toContain("## What Passed")
    })

    it("renders a Sensor Findings section with one bullet per finding", () => {
      const feedback = generateFeedback("03-sensors", {
        passed: true,
        summary: "ok",
        criteriaResults: [],
        issues: [],
        suggestions: [],
        sensorFindings: [
          { kind: "a11y", severity: "warning", summary: "axe-core reported 1 violation", path: "index.html" },
          { kind: "contrast", severity: "error", summary: "accent/bg pair 3.1:1 below 4.5:1" },
        ],
      })

      expect(feedback).toContain("## Sensor Findings")
      expect(feedback).toContain("axe-core reported 1 violation")
      expect(feedback).toContain("(index.html)")
      expect(feedback).toContain("accent/bg pair 3.1:1 below 4.5:1")
      const bullets = feedback.split("\n").filter((l) => l.startsWith("- "))
      expect(bullets.length).toBeGreaterThanOrEqual(2)
    })

    it("omits the Sensor Findings section when the array is empty", () => {
      const feedback = generateFeedback("03-sensors", {
        passed: true,
        summary: "ok",
        criteriaResults: [{ criterion: 1, passed: true, notes: "ok" }],
        issues: [],
        suggestions: [],
        sensorFindings: [],
      })

      expect(feedback).not.toContain("## Sensor Findings")
    })
  })
})
