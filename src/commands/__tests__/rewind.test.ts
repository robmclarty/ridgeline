import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"

vi.mock("../../stores/state", () => ({
  rewindTo: vi.fn(() => []),
  getPipelineStatus: vi.fn(() => ({
    shape: "complete",
    design: "skipped",
    spec: "pending",
    research: "skipped",
    refine: "skipped",
    plan: "pending",
    build: "pending",
  })),
}))

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
}))

import { rewindTo, getPipelineStatus } from "../../stores/state"
import { printError, printInfo } from "../../ui/output"
import { runRewind } from "../rewind"

describe("commands/rewind", () => {
  let origCwd: string
  let tmpDir: string
  let buildDir: string
  const buildName = "test-build"

  beforeEach(() => {
    vi.clearAllMocks()
    origCwd = process.cwd()
    tmpDir = makeTempDir()
    process.chdir(tmpDir)

    buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("prints error on invalid stage name", () => {
    runRewind(buildName, "invalid-stage")

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("Invalid stage"))
  })

  it("prints error when build directory does not exist", () => {
    fs.rmSync(buildDir, { recursive: true, force: true })

    runRewind(buildName, "shape")

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("Build directory not found"))
  })

  it("calls rewindTo with correct arguments", () => {
    runRewind(buildName, "spec")

    expect(rewindTo).toHaveBeenCalledWith(expect.stringContaining(buildName), buildName, "spec")
  })

  it("deletes files returned by rewindTo", () => {
    // Use realpath to match what the command will resolve
    const realBuildDir = fs.realpathSync(buildDir)
    const fileToDelete = path.join(realBuildDir, "research.md")
    fs.writeFileSync(fileToDelete, "research content")

    vi.mocked(rewindTo).mockReturnValue([fileToDelete])

    runRewind(buildName, "spec")

    expect(fs.existsSync(fileToDelete)).toBe(false)
  })

  it("prints pipeline status after rewind", () => {
    runRewind(buildName, "shape")

    expect(getPipelineStatus).toHaveBeenCalledWith(expect.stringContaining(buildName))
    expect(printInfo).toHaveBeenCalledWith(expect.stringContaining("Rewinding"))
  })

  it("handles already-deleted files gracefully", () => {
    vi.mocked(rewindTo).mockReturnValue(["/nonexistent/file.md"])

    expect(() => runRewind(buildName, "spec")).not.toThrow()
  })
})
