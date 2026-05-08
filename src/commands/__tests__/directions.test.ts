import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup.js"

vi.mock("../qa-workflow.js", () => ({
  runOneShotCall: vi.fn(),
}))

vi.mock("../../engine/discovery/agent.registry.js", () => ({
  buildAgentRegistry: vi.fn(() => ({
    getCorePrompt: () => "(stub system prompt)",
    getSpecialist: () => ({ overlay: "(stub design-specialist prompt)" }),
  })),
}))

vi.mock("../../stores/state.js", () => ({
  getMatchedShapes: vi.fn(),
}))

vi.mock("../../ui/output.js", () => ({
  printInfo: vi.fn(),
  printWarn: vi.fn(),
  printError: vi.fn(),
}))

import { runOneShotCall } from "../qa-workflow.js"
import { getMatchedShapes } from "../../stores/state.js"
import { runDirections } from "../directions.js"

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
    const { runDirections: rerun } = await import("../directions.js")
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
    const { runDirections: rerun } = await import("../directions.js")
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
    const { runDirections: rerun } = await import("../directions.js")
    await rerun(buildName, { model: "opus", timeout: 15 })

    expect(fs.existsSync(path.join(outputDir, "picked.txt"))).toBe(false)
  })

  it("throws when the picked id is not among generated directions", async () => {
    vi.mocked(getMatchedShapes).mockReturnValue(["web-visual"])
    const outputDir = path.join(buildDir, "directions")
    stubAgentRun(outputDir, ["01-foo", "02-bar"])
    stubReadlinePick("99-bogus")
    const { runDirections: rerun } = await import("../directions.js")
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

  // -------------------------------------------------------------------------
  // runDirectionsAuto
  // -------------------------------------------------------------------------

  /**
   * Stubs N specialist calls (each writes one direction folder) plus an
   * optional picker call. The picker is invoked only when inspiration is
   * provided. Returns the final mock so callers can inspect calls.
   */
  const stubAutoSpecialistsAndPicker = (
    outputDir: string,
    specialistIds: string[],
    pickerOutput: string | null,
  ): void => {
    let invocation = 0
    vi.mocked(runOneShotCall).mockImplementation(async () => {
      const idx = invocation++
      if (idx < specialistIds.length) {
        // Specialist call: write its assigned folder.
        const id = specialistIds[idx]
        const dir = path.join(outputDir, id)
        fs.mkdirSync(path.join(dir, "demo"), { recursive: true })
        fs.writeFileSync(path.join(dir, "brief.md"), `# ${id}\n`)
        fs.writeFileSync(path.join(dir, "tokens.md"), `# tokens ${id}\n`)
        fs.writeFileSync(path.join(dir, "demo", "index.html"), `<!doctype html><title>${id}</title>`)
        return { result: "specialist done", sessionId: `s-${idx}` }
      }
      // Picker call.
      return { result: pickerOutput ?? "PICKED: ambiguous", sessionId: "picker" }
    })
  }

  it("runDirectionsAuto dispatches N parallel specialists then picker", async () => {
    vi.mocked(getMatchedShapes).mockReturnValue(["web-visual"])
    const outputDir = path.join(buildDir, "directions")
    const ids = ["01-tactile", "02-brutalist", "03-gemcut"]
    stubAutoSpecialistsAndPicker(outputDir, ids, `PICKED: ${ids[1]}`)
    const { runDirectionsAuto } = await import("../directions.js")
    await runDirectionsAuto(buildName, {
      model: "opus",
      timeout: 15,
      count: 3,
      inspiration: "I love brutalist schematic blueprints",
    })

    // 3 specialists + 1 picker = 4 calls.
    expect(runOneShotCall).toHaveBeenCalledTimes(4)
    expect(fs.readFileSync(path.join(outputDir, "picked.txt"), "utf-8").trim()).toBe(ids[1])
  })

  it("runDirectionsAuto falls back to interactive prompt when picker returns ambiguous", async () => {
    vi.mocked(getMatchedShapes).mockReturnValue(["web-visual"])
    const outputDir = path.join(buildDir, "directions")
    stubAutoSpecialistsAndPicker(outputDir, ["01-a", "02-b"], "PICKED: ambiguous")
    stubReadlinePick("01-a")
    const { runDirectionsAuto } = await import("../directions.js")
    await runDirectionsAuto(buildName, {
      model: "opus",
      timeout: 15,
      count: 2,
      inspiration: "vague",
    })

    expect(fs.readFileSync(path.join(outputDir, "picked.txt"), "utf-8").trim()).toBe("01-a")
  })

  it("runDirectionsAuto skips picker entirely and prompts interactively when no inspiration is provided", async () => {
    vi.mocked(getMatchedShapes).mockReturnValue(["web-visual"])
    const outputDir = path.join(buildDir, "directions")
    stubAutoSpecialistsAndPicker(outputDir, ["01-a", "02-b"], null)
    stubReadlinePick("02-b")
    const { runDirectionsAuto } = await import("../directions.js")
    await runDirectionsAuto(buildName, {
      model: "opus",
      timeout: 15,
      count: 2,
    })

    // 2 specialists + 0 picker calls (skipped because no inspiration).
    expect(runOneShotCall).toHaveBeenCalledTimes(2)
    expect(fs.readFileSync(path.join(outputDir, "picked.txt"), "utf-8").trim()).toBe("02-b")
  })

  it("runDirectionsAuto skips entirely when shape is non-visual", async () => {
    vi.mocked(getMatchedShapes).mockReturnValue(["backend-api"])
    const { runDirectionsAuto } = await import("../directions.js")
    await runDirectionsAuto(buildName, { model: "opus", timeout: 15, count: 3 })
    expect(runOneShotCall).not.toHaveBeenCalled()
  })
})
