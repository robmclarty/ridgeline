import * as fs from "node:fs"
import { ReviewVerdict } from "../types"
import { generateFeedback } from "./feedback.verdict"

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
