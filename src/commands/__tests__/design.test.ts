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
    getCorePrompt: vi.fn(() => "You are a designer."),
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
}))

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
}))

vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => ({
    question: (_prompt: string, cb: (answer: string) => void) => cb(""),
    close: vi.fn(),
  })),
}))

import { invokeClaude } from "../../engine/claude/claude.exec"
import { advancePipeline } from "../../stores/state"
import { runDesign } from "../design"

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

const intakeResult = makeClaudeResult({ ready: true, summary: "Got it" })
const designContent = "# Design System\n\n## Colors\n\nPrimary: #2563EB"
const designResult = makeClaudeResult(designContent)

const defaultOpts = { model: "claude-opus-4-5", timeout: 10 }

describe("commands/design", () => {
  let origCwd: string
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    origCwd = process.cwd()
    tmpDir = makeTempDir()
    process.chdir(tmpDir)

    // Default: intake (ready: true), then design output
    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(intakeResult)
      .mockResolvedValueOnce(designResult)
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("writes design.md to build directory when buildName is provided", async () => {
    const buildName = "my-build"
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })

    await runDesign(buildName, defaultOpts)

    const designPath = path.join(buildDir, "design.md")
    expect(fs.existsSync(designPath)).toBe(true)
    expect(fs.readFileSync(designPath, "utf-8")).toBe(designContent)
  })

  it("writes design.md to ridgeline directory when buildName is null", async () => {
    const ridgelineDir = path.join(tmpDir, ".ridgeline")
    fs.mkdirSync(ridgelineDir, { recursive: true })

    await runDesign(null, defaultOpts)

    const designPath = path.join(ridgelineDir, "design.md")
    expect(fs.existsSync(designPath)).toBe(true)
    expect(fs.readFileSync(designPath, "utf-8")).toBe(designContent)
  })

  it("calls advancePipeline for build-context mode", async () => {
    const buildName = "my-build"
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })

    await runDesign(buildName, defaultOpts)

    expect(advancePipeline).toHaveBeenCalledTimes(1)
    const [calledDir, calledName, calledPhase] = vi.mocked(advancePipeline).mock.calls[0]
    expect(fs.realpathSync(calledDir)).toBe(fs.realpathSync(buildDir))
    expect(calledName).toBe(buildName)
    expect(calledPhase).toBe("design")
  })

  it("does not call advancePipeline for standalone mode", async () => {
    const ridgelineDir = path.join(tmpDir, ".ridgeline")
    fs.mkdirSync(ridgelineDir, { recursive: true })

    await runDesign(null, defaultOpts)

    expect(advancePipeline).not.toHaveBeenCalled()
  })

  it("reads existing design.md as context in the user prompt", async () => {
    const ridgelineDir = path.join(tmpDir, ".ridgeline")
    fs.mkdirSync(ridgelineDir, { recursive: true })

    const existingDesign = "# Existing Design\n\nSome pre-existing design context."
    fs.writeFileSync(path.join(ridgelineDir, "design.md"), existingDesign)

    // Re-mock so design output doesn't collide with file we wrote
    vi.mocked(invokeClaude)
      .mockReset()
      .mockResolvedValueOnce(intakeResult)
      .mockResolvedValueOnce(makeClaudeResult("# Updated Design"))

    await runDesign(null, defaultOpts)

    // The first invokeClaude call is the intake turn — check userPrompt contains existing content
    const firstCall = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(firstCall.userPrompt).toContain("Existing Design")
    expect(firstCall.userPrompt).toContain("Some pre-existing design context.")
  })
})
