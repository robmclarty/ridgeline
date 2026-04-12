import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import { readHandoff, ensureHandoffExists, ensurePhaseHandoffExists, consolidateHandoffs } from "../handoff"

describe("handoff", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe("readHandoff", () => {
    it("returns empty string when handoff.md does not exist", () => {
      expect(readHandoff(tmpDir)).toBe("")
    })

    it("returns content of handoff.md", () => {
      fs.writeFileSync(path.join(tmpDir, "handoff.md"), "Phase 1 notes")
      expect(readHandoff(tmpDir)).toBe("Phase 1 notes")
    })
  })

  describe("ensureHandoffExists", () => {
    it("creates handoff.md if it does not exist", () => {
      ensureHandoffExists(tmpDir)
      expect(fs.existsSync(path.join(tmpDir, "handoff.md"))).toBe(true)
    })

    it("does not overwrite existing handoff.md", () => {
      fs.writeFileSync(path.join(tmpDir, "handoff.md"), "existing content")
      ensureHandoffExists(tmpDir)
      expect(fs.readFileSync(path.join(tmpDir, "handoff.md"), "utf-8")).toBe("existing content")
    })
  })

  describe("ensurePhaseHandoffExists", () => {
    it("creates a phase-specific handoff file and returns its path", () => {
      const fp = ensurePhaseHandoffExists(tmpDir, "01-scaffold")
      expect(fs.existsSync(fp)).toBe(true)
      expect(fp).toContain("handoff-01-scaffold.md")
    })
  })

  describe("consolidateHandoffs", () => {
    it("appends fragments to handoff.md in order and removes them", () => {
      fs.writeFileSync(path.join(tmpDir, "handoff.md"), "existing\n")
      fs.writeFileSync(path.join(tmpDir, "handoff-01-scaffold.md"), "phase 1 notes")
      fs.writeFileSync(path.join(tmpDir, "handoff-02-api.md"), "phase 2 notes")

      consolidateHandoffs(tmpDir, ["01-scaffold", "02-api"])

      const content = fs.readFileSync(path.join(tmpDir, "handoff.md"), "utf-8")
      expect(content).toContain("existing")
      expect(content).toContain("phase 1 notes")
      expect(content).toContain("phase 2 notes")
      // Fragment order preserved
      expect(content.indexOf("phase 1")).toBeLessThan(content.indexOf("phase 2"))
      // Fragments removed
      expect(fs.existsSync(path.join(tmpDir, "handoff-01-scaffold.md"))).toBe(false)
      expect(fs.existsSync(path.join(tmpDir, "handoff-02-api.md"))).toBe(false)
    })

    it("handles empty fragments gracefully", () => {
      fs.writeFileSync(path.join(tmpDir, "handoff-01-scaffold.md"), "")

      consolidateHandoffs(tmpDir, ["01-scaffold"])

      const content = fs.readFileSync(path.join(tmpDir, "handoff.md"), "utf-8")
      expect(content.trim()).toBe("")
    })
  })
})
