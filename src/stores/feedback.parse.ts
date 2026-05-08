import { ReviewIssue, ReviewVerdict } from "../types.js"

// Normalize an issue entry — accept both string and object forms
const normalizeIssue = (item: unknown, severity: "blocking" | "suggestion"): ReviewIssue => {
  if (typeof item === "string") {
    return { description: item, severity }
  }
  if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>
    return {
      criterion: typeof obj.criterion === "number" ? obj.criterion : undefined,
      description: typeof obj.description === "string" ? obj.description : "",
      file: typeof obj.file === "string" ? obj.file : undefined,
      severity,
      requiredState: typeof obj.requiredState === "string" ? obj.requiredState : undefined,
    }
  }
  return { description: String(item), severity }
}

// Try to parse a raw object as a ReviewVerdict
const tryParseVerdict = (raw: unknown): ReviewVerdict | null => {
  if (typeof raw !== "object" || raw === null) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.passed !== "boolean") return null

  return {
    passed: obj.passed,
    summary: typeof obj.summary === "string" ? obj.summary : "",
    criteriaResults: Array.isArray(obj.criteriaResults)
      ? obj.criteriaResults.map((cr: Record<string, unknown>) => ({
          criterion: typeof cr.criterion === "number" ? cr.criterion : 0,
          passed: typeof cr.passed === "boolean" ? cr.passed : false,
          notes: typeof cr.notes === "string" ? cr.notes : "",
        }))
      : [],
    issues: Array.isArray(obj.issues)
      ? obj.issues.map((i: unknown) => normalizeIssue(i, "blocking"))
      : [],
    suggestions: Array.isArray(obj.suggestions)
      ? obj.suggestions.map((s: unknown) => normalizeIssue(s, "suggestion"))
      : [],
    sensorFindings: [],
  }
}

// Find the end index of a balanced JSON object starting at position 0 in `text`.
// Returns the index of the closing brace, or -1 if no balanced pair is found.
const findBalancedBrace = (text: string): number => {
  let depth = 0
  let inString = false
  let escape = false
  for (let j = 0; j < text.length; j++) {
    const ch = text[j]
    if (escape) { escape = false; continue }
    if (ch === "\\") { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === "{") depth++
    if (ch === "}") {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}

// Try to parse a JSON object starting at `text` as a ReviewVerdict.
// First tries the full slice, then tries balanced brace extraction.
const tryExtractVerdictAt = (text: string): ReviewVerdict | null => {
  try {
    return tryParseVerdict(JSON.parse(text))
  } catch {
    const end = findBalancedBrace(text)
    if (end === -1) return null
    try {
      return tryParseVerdict(JSON.parse(text.slice(0, end + 1)))
    } catch {
      return null
    }
  }
}

const UNPARSEABLE_VERDICT: ReviewVerdict = {
  passed: false,
  summary: "Could not parse reviewer verdict from output",
  criteriaResults: [],
  issues: [{ description: "Reviewer output did not contain a valid JSON verdict", severity: "blocking" }],
  suggestions: [],
  sensorFindings: [],
}

// Extract the JSON verdict block from reviewer's text output
export const parseVerdict = (text: string): ReviewVerdict => {
  // Try extracting from fenced code block first
  const fencedMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fencedMatch) {
    const result = tryExtractVerdictAt(fencedMatch[1])
    if (result) return result
  }

  // Scan every { and try to parse a verdict from that position
  for (let i = text.indexOf("{"); i !== -1; i = text.indexOf("{", i + 1)) {
    const result = tryExtractVerdictAt(text.slice(i))
    if (result) return result
  }

  return UNPARSEABLE_VERDICT
}
