import * as fs from "node:fs"
import { ReviewIssue, ReviewVerdict } from "../types"

// Compute the feedback file path from a phase spec filepath
export const feedbackPath = (phaseFilepath: string): string =>
  phaseFilepath.replace(/\.md$/, ".feedback.md")

// Compute the archived feedback file path for a specific attempt
export const archiveFeedbackPath = (phaseFilepath: string, attempt: number): string =>
  phaseFilepath.replace(/\.md$/, `.feedback.${attempt}.md`)

// Read the current feedback file for a phase, or null if none exists
export const readFeedback = (phaseFilepath: string): string | null => {
  const fp = feedbackPath(phaseFilepath)
  if (fs.existsSync(fp)) {
    return fs.readFileSync(fp, "utf-8")
  }
  return null
}

// Write the current feedback file for the builder to read on retry
export const writeFeedback = (phaseFilepath: string, phaseId: string, verdict: ReviewVerdict): void => {
  fs.writeFileSync(feedbackPath(phaseFilepath), generateFeedback(phaseId, verdict), "utf-8")
}

// Write an archived feedback file for post-build analysis
export const archiveFeedback = (phaseFilepath: string, phaseId: string, verdict: ReviewVerdict, attempt: number): void => {
  fs.writeFileSync(archiveFeedbackPath(phaseFilepath, attempt), generateFeedback(phaseId, verdict), "utf-8")
}

// Normalize an issue entry — accept both string and object forms
const normalizeIssue = (item: unknown, severity: "blocking" | "suggestion"): ReviewIssue => {
  if (typeof item === "string") {
    return { description: item, severity }
  }
  if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>
    return {
      criterion: typeof obj.criterion === "number" ? obj.criterion : undefined,
      description: typeof obj.description === "string" ? obj.description : String(obj.description ?? ""),
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
  }
}

// Extract the JSON verdict block from reviewer's text output
export const parseVerdict = (text: string): ReviewVerdict => {
  // Try extracting from fenced code block first
  const fencedMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fencedMatch) {
    try {
      const result = tryParseVerdict(JSON.parse(fencedMatch[1]))
      if (result) return result
    } catch {
      // Fall through
    }
  }

  // Brute-force: scan every { and try JSON.parse from that position.
  // For each {, first try the full slice, then try to find the matching }
  // by scanning for } from the end of the string backwards.
  for (let i = text.indexOf("{"); i !== -1; i = text.indexOf("{", i + 1)) {
    const slice = text.slice(i)
    try {
      const result = tryParseVerdict(JSON.parse(slice))
      if (result) return result
    } catch {
      // Full slice failed (likely trailing text) — try to find balanced closing brace
      let depth = 0
      let inString = false
      let escape = false
      for (let j = 0; j < slice.length; j++) {
        const ch = slice[j]
        if (escape) { escape = false; continue }
        if (ch === "\\") { escape = true; continue }
        if (ch === '"') { inString = !inString; continue }
        if (inString) continue
        if (ch === "{") depth++
        if (ch === "}") {
          depth--
          if (depth === 0) {
            try {
              const result = tryParseVerdict(JSON.parse(slice.slice(0, j + 1)))
              if (result) return result
            } catch {
              // Not valid JSON at this brace pair
            }
            break
          }
        }
      }
    }
  }

  // Default: unparseable
  return {
    passed: false,
    summary: "Could not parse reviewer verdict from output",
    criteriaResults: [],
    issues: [{ description: "Reviewer output did not contain a valid JSON verdict", severity: "blocking" }],
    suggestions: [],
  }
}

// Format a ReviewIssue for display
export const formatIssue = (issue: ReviewIssue): string => {
  const parts: string[] = []
  if (issue.file) parts.push(issue.file)
  parts.push(issue.description)
  return parts.join(": ")
}

// Generate feedback markdown from a structured verdict
export const generateFeedback = (phaseId: string, verdict: ReviewVerdict): string => {
  const lines: string[] = []

  lines.push(`# Reviewer Feedback: Phase ${phaseId}`)
  lines.push("")

  // Failed criteria
  const failed = verdict.criteriaResults.filter((cr) => !cr.passed)
  if (failed.length > 0) {
    lines.push("## Failed Criteria")
    lines.push("")
    for (const cr of failed) {
      lines.push(`### Criterion ${cr.criterion}`)
      lines.push(`**Status:** FAIL`)
      lines.push(`**Evidence:** ${cr.notes}`)
      // Find matching issue with requiredState
      const matchingIssue = verdict.issues.find((i) => i.criterion === cr.criterion)
      if (matchingIssue?.requiredState) {
        lines.push(`**Required state:** ${matchingIssue.requiredState}`)
      }
      lines.push("")
    }
  }

  // Blocking issues
  const blocking = verdict.issues.filter((i) => i.severity === "blocking")
  if (blocking.length > 0) {
    lines.push("## Issues")
    lines.push("")
    for (const issue of blocking) {
      const filePart = issue.file ? ` (${issue.file})` : ""
      lines.push(`- ${issue.description}${filePart}`)
      if (issue.requiredState) {
        lines.push(`  - **Required:** ${issue.requiredState}`)
      }
    }
    lines.push("")
  }

  // What passed
  const passed = verdict.criteriaResults.filter((cr) => cr.passed)
  if (passed.length > 0) {
    lines.push("## What Passed")
    lines.push("")
    for (const cr of passed) {
      lines.push(`- Criterion ${cr.criterion}: ${cr.notes}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}
