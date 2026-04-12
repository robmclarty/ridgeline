import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../../test/setup"
import { resolveFlavour } from "../flavour.resolve"

describe("resolveFlavour", () => {
  let tmpDir: string
  let origCwd: string

  beforeEach(() => {
    origCwd = process.cwd()
    tmpDir = makeTempDir()
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("returns null when flavour is null", () => {
    expect(resolveFlavour(null)).toBeNull()
  })

  it("returns null when flavour is empty string", () => {
    expect(resolveFlavour("")).toBeNull()
  })

  describe("path-like input", () => {
    it("resolves a relative path containing /", () => {
      const flavourDir = path.join(tmpDir, "custom", "flavour")
      fs.mkdirSync(flavourDir, { recursive: true })
      process.chdir(tmpDir)

      const result = resolveFlavour("./custom/flavour")

      expect(fs.realpathSync(result!)).toBe(fs.realpathSync(flavourDir))
    })

    it("resolves an absolute path", () => {
      const flavourDir = path.join(tmpDir, "my-flavour")
      fs.mkdirSync(flavourDir, { recursive: true })

      const result = resolveFlavour(flavourDir)

      expect(result).toBe(flavourDir)
    })

    it("throws when path does not exist", () => {
      expect(() => resolveFlavour("./nonexistent/path")).toThrow("Flavour path not found")
    })

    it("throws when path points to a file, not a directory", () => {
      const filePath = path.join(tmpDir, "not-a-dir")
      fs.writeFileSync(filePath, "content")
      process.chdir(tmpDir)

      expect(() => resolveFlavour("./not-a-dir")).toThrow("Flavour path not found")
    })
  })

  describe("built-in name resolution", () => {
    it("resolves a known built-in flavour name", () => {
      // The built-in flavours directory exists at src/flavours/
      const result = resolveFlavour("software-engineering")

      expect(result).not.toBeNull()
      expect(result!).toContain("software-engineering")
      expect(fs.statSync(result!).isDirectory()).toBe(true)
    })

    it("throws with available flavour list for unknown name", () => {
      expect(() => resolveFlavour("nonexistent-flavour")).toThrow(/Unknown flavour "nonexistent-flavour"/)
      expect(() => resolveFlavour("nonexistent-flavour")).toThrow(/Available flavours:/)
    })
  })
})
