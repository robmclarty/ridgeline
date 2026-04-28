import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"

vi.mock("../qa-workflow", () => ({
  runOneShotCall: vi.fn(),
}))

vi.mock("../../engine/discovery/agent.registry", () => ({
  buildAgentRegistry: vi.fn(() => ({
    getCorePrompt: () => "(stub system prompt)",
  })),
}))

vi.mock("../../stores/state", () => ({
  getMatchedShapes: vi.fn(),
}))

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
  printWarn: vi.fn(),
  printError: vi.fn(),
}))

import { runOneShotCall } from "../qa-workflow"
import { getMatchedShapes } from "../../stores/state"
import { runDirections } from "../directions"

const stubAgentRun = (outputDir: string, ids: string[]): void => {
  vi.mocked(runOneShotCall).mockImplementation(async () => {
    fs.mkdirSync(outputDir, { recursive: true })
    for (const id of ids) {
      const dir = path.join(outputDir, id)
      fs.mkdirSync(path.join(dir, "demo"), { recursive: true })
      fs.writeFileSync(path.join(dir, "brief.md"), `# ${id}\n`)
      fs.writeFileSync(path.join(dir, "tokens.md"), `# tokens for ${id}\n`)
      fs.writeFileSync(path.join(dir, "demo", "index.html"), `<!doctype html><title>${id}</title>`)
    }
    return { result: "done", sessionId: "stub" }
  })
}

const stubReadlinePick = (answer: string) => {
  vi.doMock("node:readline", () => ({
    createInterface: () => ({
      question: (_q: string, cb: (a: string) => void) => cb(answer),
      close: () => {},
    }),
  }))
}

describe("commands/directions", () => {
  let origCwd: string
  let tmpDir: string
  let buildDir: string
  const buildName = "test-directions"

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    origCwd = process.cwd()
    tmpDir = makeTempDir()
    process.chdir(tmpDir)
    buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })
    fs.writeFileSync(path.join(buildDir, "shape.md"), "# Test\n")
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("throws when the build directory does not exist", async () => {
    vi.mocked(getMatchedShapes).mockReturnValue([])
    fs.rmSync(buildDir, { recursive: true })
    await expect(runDirections(buildName, { model: "opus", timeout: 15 })).rejects.toThrow(
      /Build directory not found/,
    )
  })

  it("no-ops when --skip is set", async () => {
    vi.mocked(getMatchedShapes).mockReturnValue(["web-visual"])
    await runDirections(buildName, { model: "opus", timeout: 15, isSkip: true })
    expect(runOneShotCall).not.toHaveBeenCalled()
  })

  it("no-ops when no visual shapes matched", async () => {
    vi.mocked(getMatchedShapes).mockReturnValue(["backend-api"])
    await runDirections(buildName, { model: "opus", timeout: 15 })
    expect(runOneShotCall).not.toHaveBeenCalled()
  })

  it("no-ops with a warning for non-web-visual visual shapes", async () => {
    vi.mocked(getMatchedShapes).mockReturnValue(["game-visual"])
    await runDirections(buildName, { model: "opus", timeout: 15 })
    expect(runOneShotCall).not.toHaveBeenCalled()
  })

  it("invokes one-shot agent with 2 directions by default", async () => {
    vi.mocked(getMatchedShapes).mockReturnValue(["web-visual"])
    const outputDir = path.join(buildDir, "directions")
    stubAgentRun(outputDir, ["01-foo", "02-bar"])
    stubReadlinePick("01-foo")
    const { runDirections: rerun } = await import("../directions")
    await rerun(buildName, { model: "opus", timeout: 15 })

    expect(runOneShotCall).toHaveBeenCalledTimes(1)
    const call = vi.mocked(runOneShotCall).mock.calls[0][0]
    expect(call.userPrompt).toContain("Generate 2 differentiated visual direction(s)")
    expect(fs.existsSync(path.join(outputDir, "picked.txt"))).toBe(true)
    expect(fs.readFileSync(path.join(outputDir, "picked.txt"), "utf-8").trim()).toBe("01-foo")
  })

  it("invokes one-shot agent with 3 directions when count is 3", async () => {
    vi.mocked(getMatchedShapes).mockReturnValue(["web-visual"])
    const outputDir = path.join(buildDir, "directions")
    stubAgentRun(outputDir, ["01-a", "02-b", "03-c"])
    stubReadlinePick("02-b")
    const { runDirections: rerun } = await import("../directions")
    await rerun(buildName, { model: "opus", timeout: 15, count: 3 })

    const call = vi.mocked(runOneShotCall).mock.calls[0][0]
    expect(call.userPrompt).toContain("Generate 3 differentiated visual direction(s)")
    expect(fs.readFileSync(path.join(outputDir, "picked.txt"), "utf-8").trim()).toBe("02-b")
  })

  it("does not write picked.txt when user enters 'none'", async () => {
    vi.mocked(getMatchedShapes).mockReturnValue(["web-visual"])
    const outputDir = path.join(buildDir, "directions")
    stubAgentRun(outputDir, ["01-foo", "02-bar"])
    stubReadlinePick("none")
    const { runDirections: rerun } = await import("../directions")
    await rerun(buildName, { model: "opus", timeout: 15 })

    expect(fs.existsSync(path.join(outputDir, "picked.txt"))).toBe(false)
  })

  it("throws when the picked id is not among generated directions", async () => {
    vi.mocked(getMatchedShapes).mockReturnValue(["web-visual"])
    const outputDir = path.join(buildDir, "directions")
    stubAgentRun(outputDir, ["01-foo", "02-bar"])
    stubReadlinePick("99-bogus")
    const { runDirections: rerun } = await import("../directions")
    await expect(rerun(buildName, { model: "opus", timeout: 15 })).rejects.toThrow(
      /does not match any generated direction/,
    )
  })

  it("throws when the agent writes no direction folders", async () => {
    vi.mocked(getMatchedShapes).mockReturnValue(["web-visual"])
    vi.mocked(runOneShotCall).mockResolvedValue({ result: "no-op", sessionId: "stub" })
    await expect(runDirections(buildName, { model: "opus", timeout: 15 })).rejects.toThrow(
      /wrote no direction folders/,
    )
  })
})
