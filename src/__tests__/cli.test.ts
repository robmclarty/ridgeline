import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../test/setup"

// Mock commander to prevent program.parse() from running on import
vi.mock("commander", () => {
  class MockCommand {
    name() { return this }
    description() { return this }
    version() { return this }
    command() { return this }
    option() { return this }
    action() { return this }
    parse() {}
  }
  return { Command: MockCommand }
})

// Mock command modules to avoid side effects
vi.mock("../commands/init", () => ({ runInit: vi.fn() }))
vi.mock("../commands/plan", () => ({ runPlan: vi.fn() }))
vi.mock("../commands/dryRun", () => ({ runDryRun: vi.fn() }))
vi.mock("../commands/run", () => ({ runBuild: vi.fn() }))

import { resolveFile, parseCheckCommand } from "../cli"

describe("cli", () => {
  describe("resolveFile", () => {
    let tmpDir: string
    let buildDir: string
    let projectDir: string

    beforeEach(() => {
      tmpDir = makeTempDir()
      buildDir = path.join(tmpDir, "build")
      projectDir = path.join(tmpDir, "project")
      fs.mkdirSync(buildDir, { recursive: true })
      fs.mkdirSync(projectDir, { recursive: true })
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it("returns CLI flag path when it exists", () => {
      const flagFile = path.join(tmpDir, "custom.md")
      fs.writeFileSync(flagFile, "custom")
      const result = resolveFile(flagFile, buildDir, "test.md", projectDir)
      expect(result).toBe(path.resolve(flagFile))
    })

    it("returns build-level file when no CLI flag", () => {
      fs.writeFileSync(path.join(buildDir, "test.md"), "build")
      const result = resolveFile(undefined, buildDir, "test.md", projectDir)
      expect(result).toBe(path.join(buildDir, "test.md"))
    })

    it("returns project-level file as fallback", () => {
      fs.writeFileSync(path.join(projectDir, "test.md"), "project")
      const result = resolveFile(undefined, buildDir, "test.md", projectDir)
      expect(result).toBe(path.join(projectDir, "test.md"))
    })

    it("returns null when file not found anywhere", () => {
      const result = resolveFile(undefined, buildDir, "missing.md", projectDir)
      expect(result).toBeNull()
    })

    it("prefers CLI flag over build-level", () => {
      const flagFile = path.join(tmpDir, "flag.md")
      fs.writeFileSync(flagFile, "flag")
      fs.writeFileSync(path.join(buildDir, "flag.md"), "build")
      const result = resolveFile(flagFile, buildDir, "flag.md", projectDir)
      expect(result).toBe(path.resolve(flagFile))
    })

    it("prefers build-level over project-level", () => {
      fs.writeFileSync(path.join(buildDir, "test.md"), "build")
      fs.writeFileSync(path.join(projectDir, "test.md"), "project")
      const result = resolveFile(undefined, buildDir, "test.md", projectDir)
      expect(result).toBe(path.join(buildDir, "test.md"))
    })
  })

  describe("parseCheckCommand", () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = makeTempDir()
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it("extracts check command from constraints.md", () => {
      const fp = path.join(tmpDir, "constraints.md")
      fs.writeFileSync(fp, [
        "# Constraints",
        "",
        "## Check Command",
        "",
        "```bash",
        "npm run build && npm test",
        "```",
      ].join("\n"))

      expect(parseCheckCommand(fp)).toBe("npm run build && npm test")
    })

    it("extracts check command without language tag", () => {
      const fp = path.join(tmpDir, "constraints.md")
      fs.writeFileSync(fp, [
        "## Check Command",
        "",
        "```",
        "make test",
        "```",
      ].join("\n"))

      expect(parseCheckCommand(fp)).toBe("make test")
    })

    it("returns null when no check command section", () => {
      const fp = path.join(tmpDir, "constraints.md")
      fs.writeFileSync(fp, "# Constraints\n\nNo check command here.")

      expect(parseCheckCommand(fp)).toBeNull()
    })

    it("returns null when file does not exist", () => {
      expect(parseCheckCommand("/nonexistent/path.md")).toBeNull()
    })
  })
})
