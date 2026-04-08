import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import { readHandoff, ensureHandoffExists } from "../handoff"

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
})
