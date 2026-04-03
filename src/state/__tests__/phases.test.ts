import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import { scanPhases, isPhaseFile, parsePhaseFilename, parsePhaseContent, PHASE_FILENAME_PATTERN } from "../phases"

describe("phases", () => {
  describe("PHASE_FILENAME_PATTERN", () => {
    it("matches valid phase filenames", () => {
      expect(PHASE_FILENAME_PATTERN.test("01-scaffold.md")).toBe(true)
      expect(PHASE_FILENAME_PATTERN.test("02-setup-database.md")).toBe(true)
      expect(PHASE_FILENAME_PATTERN.test("99-final.md")).toBe(true)
    })

    it("rejects invalid filenames", () => {
      expect(PHASE_FILENAME_PATTERN.test("README.md")).toBe(false)
      expect(PHASE_FILENAME_PATTERN.test("scaffold.md")).toBe(false)
      expect(PHASE_FILENAME_PATTERN.test("notes.txt")).toBe(false)
    })
  })

  describe("isPhaseFile", () => {
    it("accepts valid phase filenames", () => {
      expect(isPhaseFile("01-scaffold.md")).toBe(true)
      expect(isPhaseFile("02-api.md")).toBe(true)
    })

    it("rejects feedback files", () => {
      expect(isPhaseFile("01-scaffold.feedback.md")).toBe(false)
      expect(isPhaseFile("01-scaffold.feedback.0.md")).toBe(false)
    })

    it("rejects non-phase files", () => {
      expect(isPhaseFile("README.md")).toBe(false)
      expect(isPhaseFile("notes.txt")).toBe(false)
    })
  })

  describe("parsePhaseFilename", () => {
    it("extracts id, index, and slug", () => {
      const result = parsePhaseFilename("01-scaffold.md")
      expect(result).toEqual({ id: "01-scaffold", index: 1, slug: "scaffold" })
    })

    it("handles multi-word slugs", () => {
      const result = parsePhaseFilename("02-setup-database.md")
      expect(result).toEqual({ id: "02-setup-database", index: 2, slug: "setup-database" })
    })
  })

  describe("parsePhaseContent", () => {
    it("extracts title, goal, and acceptance criteria", () => {
      const content = [
        "# Phase 1: Scaffold",
        "",
        "## Goal",
        "Set up the project structure.",
        "",
        "## Acceptance Criteria",
        "1. Directory exists",
        "2. Config files present",
        "",
        "## Spec Reference",
        "Some reference.",
      ].join("\n")

      const result = parsePhaseContent(content)
      expect(result.title).toBe("Phase 1: Scaffold")
      expect(result.goal).toBe("Set up the project structure.")
      expect(result.criteria).toBe("1. Directory exists\n2. Config files present")
    })

    it("returns empty strings for missing sections", () => {
      const result = parsePhaseContent("Just some text without sections.")
      expect(result.title).toBe("")
      expect(result.goal).toBe("")
      expect(result.criteria).toBe("")
    })

    it("extracts title only", () => {
      const result = parsePhaseContent("# My Phase Title\n\nSome content.")
      expect(result.title).toBe("My Phase Title")
      expect(result.goal).toBe("")
      expect(result.criteria).toBe("")
    })
  })

  describe("scanPhases", () => {
    let phasesDir: string

    beforeEach(() => {
      phasesDir = makeTempDir()
    })

    afterEach(() => {
      fs.rmSync(phasesDir, { recursive: true, force: true })
    })

    it("returns empty array for nonexistent directory", () => {
      expect(scanPhases("/nonexistent/path")).toEqual([])
    })

    it("returns empty array for empty directory", () => {
      expect(scanPhases(phasesDir)).toEqual([])
    })

    it("parses phase files correctly", () => {
      fs.writeFileSync(path.join(phasesDir, "01-scaffold.md"), "# Scaffold")
      fs.writeFileSync(path.join(phasesDir, "02-api.md"), "# API")
      fs.writeFileSync(path.join(phasesDir, "03-ui.md"), "# UI")

      const phases = scanPhases(phasesDir)

      expect(phases).toHaveLength(3)
      expect(phases[0]).toEqual({
        id: "01-scaffold",
        index: 1,
        slug: "scaffold",
        filename: "01-scaffold.md",
        filepath: path.join(phasesDir, "01-scaffold.md"),
      })
      expect(phases[1].id).toBe("02-api")
      expect(phases[2].id).toBe("03-ui")
    })

    it("sorts phases by filename", () => {
      fs.writeFileSync(path.join(phasesDir, "03-last.md"), "")
      fs.writeFileSync(path.join(phasesDir, "01-first.md"), "")
      fs.writeFileSync(path.join(phasesDir, "02-middle.md"), "")

      const phases = scanPhases(phasesDir)
      expect(phases.map((p) => p.id)).toEqual(["01-first", "02-middle", "03-last"])
    })

    it("excludes feedback files", () => {
      fs.writeFileSync(path.join(phasesDir, "01-scaffold.md"), "")
      fs.writeFileSync(path.join(phasesDir, "01-scaffold.feedback.md"), "")

      const phases = scanPhases(phasesDir)
      expect(phases).toHaveLength(1)
      expect(phases[0].id).toBe("01-scaffold")
    })

    it("excludes files not matching phase pattern", () => {
      fs.writeFileSync(path.join(phasesDir, "01-scaffold.md"), "")
      fs.writeFileSync(path.join(phasesDir, "README.md"), "")
      fs.writeFileSync(path.join(phasesDir, "notes.txt"), "")
      fs.writeFileSync(path.join(phasesDir, "scaffold.md"), "")

      const phases = scanPhases(phasesDir)
      expect(phases).toHaveLength(1)
    })

    it("handles multi-word slugs", () => {
      fs.writeFileSync(path.join(phasesDir, "01-setup-database.md"), "")

      const phases = scanPhases(phasesDir)
      expect(phases[0].slug).toBe("setup-database")
    })
  })
})
