import { ReviewIssue, ReviewVerdict } from "../types"

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
