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

vi.mock("../../catalog/resolve-asset-dir", () => ({
  resolveAssetDirSafe: vi.fn(() => null),
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

  describe("catalog context", () => {
    const sampleCatalog = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      assetDir: "/assets",
      isDescribed: false,
      visualIdentity: {
        detectedStyle: "pixel-art",
        detectedPalette: ["#FF0000", "#00FF00"],
        detectedResolution: "32x32",
        detectedScaling: "nearest-neighbor",
      },
      warnings: ["Missing alpha channel on bg.png"],
      assets: [
        { file: "hero.png", hash: "abc", category: "characters", name: "hero", subject: "hero", state: null, width: 32, height: 32, format: "png", hasAlpha: true, channels: 4, dominantColour: "#FF0000", palette: [] },
        { file: "tree.png", hash: "def", category: "environment", name: "tree", subject: "tree", state: null, width: 32, height: 32, format: "png", hasAlpha: true, channels: 4, dominantColour: "#00FF00", palette: [] },
        { file: "sword.png", hash: "ghi", category: "characters", name: "sword", subject: "sword", state: null, width: 16, height: 16, format: "png", hasAlpha: true, channels: 4, dominantColour: "#AAAAAA", palette: [] },
      ],
    }

    it("includes catalog summary in prompt when asset-catalog.json exists in build dir", async () => {
      const buildName = "my-build"
      const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
      fs.mkdirSync(buildDir, { recursive: true })
      fs.writeFileSync(path.join(buildDir, "asset-catalog.json"), JSON.stringify(sampleCatalog))

      await runDesign(buildName, defaultOpts)

      const firstCall = vi.mocked(invokeClaude).mock.calls[0][0]
      expect(firstCall.userPrompt).toContain("Asset Catalog Summary")
      expect(firstCall.userPrompt).toContain("3 assets cataloged")
      expect(firstCall.userPrompt).toContain("characters: 2")
      expect(firstCall.userPrompt).toContain("environment: 1")
    })

    it("includes visual identity fields in catalog summary", async () => {
      const buildName = "my-build"
      const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
      fs.mkdirSync(buildDir, { recursive: true })
      fs.writeFileSync(path.join(buildDir, "asset-catalog.json"), JSON.stringify(sampleCatalog))

      await runDesign(buildName, defaultOpts)

      const firstCall = vi.mocked(invokeClaude).mock.calls[0][0]
      expect(firstCall.userPrompt).toContain("Detected style: pixel-art")
      expect(firstCall.userPrompt).toContain("Detected resolution: 32x32")
      expect(firstCall.userPrompt).toContain("Detected palette: #FF0000, #00FF00")
      expect(firstCall.userPrompt).toContain("Suggested scaling: nearest-neighbor")
    })

    it("includes warnings in catalog summary", async () => {
      const buildName = "my-build"
      const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
      fs.mkdirSync(buildDir, { recursive: true })
      fs.writeFileSync(path.join(buildDir, "asset-catalog.json"), JSON.stringify(sampleCatalog))

      await runDesign(buildName, defaultOpts)

      const firstCall = vi.mocked(invokeClaude).mock.calls[0][0]
      expect(firstCall.userPrompt).toContain("Warnings:")
      expect(firstCall.userPrompt).toContain("Missing alpha channel on bg.png")
    })

    it("handles malformed catalog JSON gracefully", async () => {
      const buildName = "my-build"
      const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
      fs.mkdirSync(buildDir, { recursive: true })
      fs.writeFileSync(path.join(buildDir, "asset-catalog.json"), "{bad json{{{")

      await runDesign(buildName, defaultOpts)

      const firstCall = vi.mocked(invokeClaude).mock.calls[0][0]
      expect(firstCall.userPrompt).not.toContain("Asset Catalog Summary")
    })

    it("finds catalog in ridgeline dir when no build dir catalog", async () => {
      const ridgelineDir = path.join(tmpDir, ".ridgeline")
      fs.mkdirSync(ridgelineDir, { recursive: true })
      fs.writeFileSync(path.join(ridgelineDir, "asset-catalog.json"), JSON.stringify(sampleCatalog))

      await runDesign(null, defaultOpts)

      const firstCall = vi.mocked(invokeClaude).mock.calls[0][0]
      expect(firstCall.userPrompt).toContain("Asset Catalog Summary")
    })
  })

  describe("matched shapes context", () => {
    it("includes matched shapes in prompt when provided", async () => {
      const buildName = "my-build"
      const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
      fs.mkdirSync(buildDir, { recursive: true })

      await runDesign(buildName, { ...defaultOpts, matchedShapes: ["api", "dashboard"] })

      const firstCall = vi.mocked(invokeClaude).mock.calls[0][0]
      expect(firstCall.userPrompt).toContain("Matched Shape Categories")
      expect(firstCall.userPrompt).toContain("api, dashboard")
    })

    it("does not include matched shapes when empty", async () => {
      const buildName = "my-build"
      const buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
      fs.mkdirSync(buildDir, { recursive: true })

      await runDesign(buildName, { ...defaultOpts, matchedShapes: [] })

      const firstCall = vi.mocked(invokeClaude).mock.calls[0][0]
      expect(firstCall.userPrompt).not.toContain("Matched Shape Categories")
    })

    it("does not include matched shapes when not provided", async () => {
      const ridgelineDir = path.join(tmpDir, ".ridgeline")
      fs.mkdirSync(ridgelineDir, { recursive: true })

      await runDesign(null, defaultOpts)

      const firstCall = vi.mocked(invokeClaude).mock.calls[0][0]
      expect(firstCall.userPrompt).not.toContain("Matched Shape Categories")
    })
  })
})
