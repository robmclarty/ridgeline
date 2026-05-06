import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"

vi.mock("../qa-workflow", () => ({
  runOneShotCall: vi.fn(),
  runQAIntake: vi.fn(),
  runOutputTurn: vi.fn(),
  askQuestion: vi.fn(),
}))

vi.mock("../design", () => ({
  runDesign: vi.fn(async () => undefined),
  runDesignAuto: vi.fn(async () => undefined),
}))

vi.mock("../../engine/discovery/agent.registry", () => ({
  buildAgentRegistry: vi.fn(() => ({
    getCorePrompt: () => "(stub shaper system prompt)",
  })),
}))

vi.mock("../../shapes/detect", () => ({
  loadShapeDefinitions: vi.fn(() => []),
  detectShapes: vi.fn(),
}))

vi.mock("../../config", () => ({
  resolveBuildDir: vi.fn((buildName: string, _opts: unknown) =>
    path.join(process.cwd(), ".ridgeline", "builds", buildName),
  ),
}))

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
  printWarn: vi.fn(),
}))

import { runOneShotCall } from "../qa-workflow"
import { runDesign, runDesignAuto } from "../design"
import { detectShapes } from "../../shapes/detect"
import { runShapeAuto } from "../shape"

const buildName = "test-shape-auto"
const baseOpts = { model: "opus", timeout: 10 }

const SHAPE_JSON = JSON.stringify({
  projectName: "test",
  intent: "ship a thing",
  scope: { size: "small", inScope: ["a"], outOfScope: ["b"] },
  solutionShape: "cli tool",
  risksAndComplexities: [],
  existingLandscape: {
    codebaseState: "empty",
    externalDependencies: [],
    dataStructures: [],
    relevantModules: [],
  },
  technicalPreferences: {
    errorHandling: "throw",
    performance: "n/a",
    security: "none",
    tradeoffs: "simple",
    style: "flat",
  },
})

describe("runShapeAuto — non-visual auto chain", () => {
  let origCwd: string
  let tmpDir: string
  let buildDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    origCwd = process.cwd()
    tmpDir = makeTempDir()
    process.chdir(tmpDir)
    buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })

    vi.mocked(runOneShotCall).mockResolvedValue({
      result: SHAPE_JSON,
      sessionId: "stub",
    })
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("chains to runDesignAuto with empty matchedShapes when no visual shape matched", async () => {
    vi.mocked(detectShapes).mockReturnValue([])

    await runShapeAuto(buildName, {
      ...baseOpts,
      inputContent: "Build a CLI tool that does X.",
      inputLabel: "idea.md",
    })

    expect(runDesignAuto).toHaveBeenCalledTimes(1)
    expect(runDesignAuto).toHaveBeenCalledWith(
      buildName,
      expect.objectContaining({ matchedShapes: [], inferGapFlagging: true }),
    )
    expect(runDesign).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(buildDir, "shape.md"))).toBe(true)
  })

  it("chains to runDesignAuto with matched names when a visual shape matched", async () => {
    vi.mocked(detectShapes).mockReturnValue([
      { name: "web-visual", description: "stub", anyOf: [] } as never,
    ])

    await runShapeAuto(buildName, {
      ...baseOpts,
      inputContent: "Build a web app.",
    })

    expect(runDesignAuto).toHaveBeenCalledTimes(1)
    expect(runDesignAuto).toHaveBeenCalledWith(
      buildName,
      expect.objectContaining({ matchedShapes: ["web-visual"], inferGapFlagging: true }),
    )
    expect(runDesign).not.toHaveBeenCalled()
  })
})
