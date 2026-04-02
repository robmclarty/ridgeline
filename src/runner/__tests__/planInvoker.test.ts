import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import { scanPhases } from "../planInvoker"

describe("planInvoker", () => {
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
