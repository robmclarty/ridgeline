import { describe, it, expect, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import {
  feedbackPath,
  archiveFeedbackPath,
  writeFeedback,
  archiveFeedback,
  readFeedback,
} from "../feedback.io"

describe("feedback.io", () => {
  describe("feedbackPath", () => {
    it("returns .feedback.md variant of phase filepath", () => {
      expect(feedbackPath("/build/phases/01-scaffold.md")).toBe("/build/phases/01-scaffold.feedback.md")
    })
  })

  describe("archiveFeedbackPath", () => {
    it("returns .feedback.{n}.md variant of phase filepath", () => {
      expect(archiveFeedbackPath("/build/phases/01-scaffold.md", 0)).toBe("/build/phases/01-scaffold.feedback.0.md")
      expect(archiveFeedbackPath("/build/phases/01-scaffold.md", 2)).toBe("/build/phases/01-scaffold.feedback.2.md")
    })
  })

  describe("writeFeedback / readFeedback", () => {
    let dir: string

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })

    it("writes and reads feedback for a phase", () => {
      dir = makeTempDir()
      const phaseFile = path.join(dir, "01-scaffold.md")
      fs.writeFileSync(phaseFile, "# Phase")

      const verdict = {
        passed: false,
        summary: "Failed",
        criteriaResults: [],
        issues: [{ description: "broken", severity: "blocking" as const }],
        suggestions: [],
      }

      writeFeedback(phaseFile, "01-scaffold", verdict)

      const content = readFeedback(phaseFile)
      expect(content).toContain("# Reviewer Feedback: Phase 01-scaffold")
      expect(content).toContain("broken")
    })

    it("returns null when no feedback exists", () => {
      dir = makeTempDir()
      const phaseFile = path.join(dir, "01-scaffold.md")
      expect(readFeedback(phaseFile)).toBeNull()
    })
  })

  describe("archiveFeedback", () => {
    let dir: string

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })

    it("writes numbered archive file", () => {
      dir = makeTempDir()
      const phaseFile = path.join(dir, "01-scaffold.md")

      const verdict = {
        passed: false,
        summary: "Failed",
        criteriaResults: [],
        issues: [{ description: "broken", severity: "blocking" as const }],
        suggestions: [],
      }

      archiveFeedback(phaseFile, "01-scaffold", verdict, 0)

      const archiveFile = path.join(dir, "01-scaffold.feedback.0.md")
      expect(fs.existsSync(archiveFile)).toBe(true)
      expect(fs.readFileSync(archiveFile, "utf-8")).toContain("broken")
    })
  })
})
