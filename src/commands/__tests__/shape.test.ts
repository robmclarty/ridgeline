import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"

vi.mock("../../engine/claude/claude.exec", () => ({
  invokeClaude: vi.fn(),
}))

vi.mock("../../engine/claude/stream.display", () => ({
  createDisplayCallbacks: vi.fn(() => ({
    onStdout: vi.fn(),
    flush: vi.fn(),
  })),
}))

vi.mock("../../engine/discovery/agent.registry", () => ({
  buildAgentRegistry: vi.fn(() => ({
    getCorePrompt: vi.fn(() => "You are a shaper."),
    getSpecialists: vi.fn(() => []),
    getSpecialist: vi.fn(() => null),
    getContext: vi.fn(() => null),
    getGaps: vi.fn(() => null),
    getSubAgents: vi.fn(() => []),
    getAgentsFlag: vi.fn(() => ({})),
  })),
}))

vi.mock("../../engine/discovery/flavour.resolve", () => ({
  resolveFlavour: vi.fn(() => null),
}))

vi.mock("../../stores/state", () => ({
  advancePipeline: vi.fn(),
  recordMatchedShapes: vi.fn(),
}))

vi.mock("../../shapes/detect", () => ({
  loadShapeDefinitions: vi.fn(() => []),
  detectShapes: vi.fn(() => []),
}))

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
}))

vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => ({
    question: (_prompt: string, cb: (answer: string) => void) => cb("Build me a todo app"),
    close: vi.fn(),
  })),
}))

vi.mock("../design", () => ({
  runDesign: vi.fn(),
}))

import { invokeClaude } from "../../engine/claude/claude.exec"
import { advancePipeline, recordMatchedShapes } from "../../stores/state"
import { detectShapes } from "../../shapes/detect"
import { printError } from "../../ui/output"
import { runDesign } from "../design"
import { runShape } from "../shape"

const makeClaudeResult = (result: unknown) => ({
  result: typeof result === "string" ? result : JSON.stringify(result),
  sessionId: "sess-1",
  costUsd: 0.01,
  durationMs: 1000,
  success: true,
  usage: {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  },
})

const validShapeOutput = {
  projectName: "Todo App",
  intent: "Build a simple todo application",
  scope: { size: "small", inScope: ["task CRUD"], outOfScope: ["auth"] },
  solutionShape: "A web-based todo app",
  risksAndComplexities: ["none significant"],
  existingLandscape: {
    codebaseState: "greenfield",
    externalDependencies: [],
    dataStructures: [],
    relevantModules: [],
  },
  technicalPreferences: {
    errorHandling: "standard",
    performance: "standard",
    security: "minimal",
    tradeoffs: "simplicity over features",
    style: "functional",
  },
}

const intakeResult = makeClaudeResult({ ready: true, summary: "Got it" })
const shapeJsonResult = makeClaudeResult(validShapeOutput)

const defaultOpts = { model: "opus", timeout: 10 }

describe("commands/shape", () => {
  let origCwd: string
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    origCwd = process.cwd()
    tmpDir = makeTempDir()
    process.chdir(tmpDir)

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(intakeResult)
      .mockResolvedValueOnce(shapeJsonResult)
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("writes shape.md when shaper returns valid JSON", async () => {
    const buildName = "my-build"
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })

    await runShape(buildName, defaultOpts)

    const shapePath = path.join(buildDir, "shape.md")
    expect(fs.existsSync(shapePath)).toBe(true)
    const content = fs.readFileSync(shapePath, "utf-8")
    expect(content).toContain("# Todo App")
    expect(content).toContain("## Intent")
  })

  it("writes raw output when JSON parsing fails", async () => {
    vi.mocked(invokeClaude)
      .mockReset()
      .mockResolvedValueOnce(intakeResult)
      .mockResolvedValueOnce(makeClaudeResult("This is not JSON, just markdown"))

    const buildName = "my-build"
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })

    await runShape(buildName, defaultOpts)

    const content = fs.readFileSync(path.join(buildDir, "shape.md"), "utf-8")
    expect(content).toBe("This is not JSON, just markdown")
  })

  it("calls advancePipeline with 'shape'", async () => {
    const buildName = "my-build"
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })

    await runShape(buildName, defaultOpts)

    expect(advancePipeline).toHaveBeenCalledTimes(1)
    const [, calledName, calledStage] = vi.mocked(advancePipeline).mock.calls[0]
    expect(calledName).toBe(buildName)
    expect(calledStage).toBe("shape")
  })

  it("auto-chains to design when visual shapes are detected", async () => {
    vi.mocked(detectShapes).mockReturnValue([
      { name: "web-ui", description: "Web UI", keywords: [], matchedKeywords: [] },
    ])

    const buildName = "my-build"
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })

    await runShape(buildName, defaultOpts)

    expect(recordMatchedShapes).toHaveBeenCalledWith(
      expect.any(String), buildName, ["web-ui"],
    )
    expect(runDesign).toHaveBeenCalledTimes(1)
  })

  it("does not chain to design when no shapes detected", async () => {
    vi.mocked(detectShapes).mockReturnValue([])

    const buildName = "my-build"
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })

    await runShape(buildName, defaultOpts)

    expect(runDesign).not.toHaveBeenCalled()
  })

  it("reads input from file when input option is a file path", async () => {
    const inputFile = path.join(tmpDir, "project-brief.md")
    fs.writeFileSync(inputFile, "Build me a todo app with React")

    const buildName = "my-build"
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })

    await runShape(buildName, { ...defaultOpts, input: inputFile })

    const firstCall = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(firstCall.userPrompt).toContain("Build me a todo app with React")
  })

  it("prints error when no description is provided", async () => {
    // Mock readline to return empty string
    const readline = await import("node:readline")
    vi.mocked(readline.createInterface).mockReturnValue({
      question: (_prompt: string, cb: (answer: string) => void) => cb(""),
      close: vi.fn(),
    } as any)

    const buildName = "my-build"
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })

    await runShape(buildName, defaultOpts)

    expect(printError).toHaveBeenCalledWith("A description is required")
  })
})
