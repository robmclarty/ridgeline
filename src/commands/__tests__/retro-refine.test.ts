import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup.js"

vi.mock("../../engine/claude/claude.exec.js", () => ({
  invokeClaude: vi.fn(),
}))

vi.mock("../../engine/claude/stream.display.js", () => ({
  createDisplayCallbacks: vi.fn(() => ({ onStdout: vi.fn(), flush: vi.fn() })),
}))

vi.mock("../../engine/discovery/agent.registry.js", () => ({
  buildAgentRegistry: vi.fn(() => ({
    getCorePrompt: () => "(stub retro-refiner system prompt)",
  })),
}))

vi.mock("../../ui/output.js", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
  printWarn: vi.fn(),
}))

import { invokeClaude } from "../../engine/claude/claude.exec.js"
import { printError, printWarn, printInfo } from "../../ui/output.js"
import { runRetroRefine } from "../retro-refine.js"
import { recordInputSource } from "../../stores/state.js"

const opts = { model: "opus", timeout: 10 }
const REFINED_HEADING = "# Refined input (from retrospective)"

describe("commands/retro-refine", () => {
  let origCwd: string
  let tmpDir: string
  let buildDir: string
  let ridgelineDir: string
  const buildName = "test-build"

  beforeEach(() => {
    vi.clearAllMocks()
    origCwd = process.cwd()
    tmpDir = makeTempDir()
    process.chdir(tmpDir)
    ridgelineDir = path.join(tmpDir, ".ridgeline")
    buildDir = path.join(ridgelineDir, "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("errors when build directory does not exist", async () => {
    fs.rmSync(buildDir, { recursive: true, force: true })
    await runRetroRefine(buildName, opts)
    expect(printError).toHaveBeenCalledWith(expect.stringContaining("Build directory not found"))
  })

  it("warns and exits when learnings.md is missing", async () => {
    await runRetroRefine(buildName, opts)
    expect(printWarn).toHaveBeenCalledWith(expect.stringMatching(/learnings\.md is empty or missing/))
    expect(invokeClaude).not.toHaveBeenCalled()
  })

  it("warns when learnings.md is present but empty", async () => {
    fs.writeFileSync(path.join(ridgelineDir, "learnings.md"), "   \n\n  ")
    await runRetroRefine(buildName, opts)
    expect(printWarn).toHaveBeenCalledWith(expect.stringMatching(/learnings\.md is empty or missing/))
    expect(invokeClaude).not.toHaveBeenCalled()
  })

  it("writes refined-input.md when learnings.md exists and output starts with the expected heading", async () => {
    fs.writeFileSync(path.join(ridgelineDir, "learnings.md"), "# Build Learnings\n\n## Build: test (2026-05-05)\nLearnings here.\n")
    fs.writeFileSync(path.join(buildDir, "spec.md"), "# Spec")
    const sourcePath = path.join(tmpDir, "idea.md")
    fs.writeFileSync(sourcePath, "Original idea.")
    recordInputSource(buildDir, buildName, sourcePath)

    vi.mocked(invokeClaude).mockResolvedValue({
      result: `${REFINED_HEADING}\n\nRefined body here.\n`,
      success: true,
      durationMs: 1000,
      costUsd: 0.1,
      sessionId: "s1",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    })

    await runRetroRefine(buildName, opts)

    const outputPath = path.join(buildDir, "refined-input.md")
    expect(fs.existsSync(outputPath)).toBe(true)
    const written = fs.readFileSync(outputPath, "utf-8")
    expect(written.startsWith(REFINED_HEADING)).toBe(true)
    expect(printInfo).toHaveBeenCalledWith(expect.stringMatching(/Refined input written to/))
  })

  it("does not write the file when output is missing the expected heading", async () => {
    fs.writeFileSync(path.join(ridgelineDir, "learnings.md"), "## Build: test\nLearnings.\n")
    vi.mocked(invokeClaude).mockResolvedValue({
      result: "Some output without the right heading.",
      success: true,
      durationMs: 1000,
      costUsd: 0.1,
      sessionId: "s1",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    })

    await runRetroRefine(buildName, opts)

    expect(fs.existsSync(path.join(buildDir, "refined-input.md"))).toBe(false)
    expect(printWarn).toHaveBeenCalledWith(expect.stringMatching(/did not start with/))
  })

  it("falls back gracefully when inputSource path no longer exists on disk", async () => {
    fs.writeFileSync(path.join(ridgelineDir, "learnings.md"), "## Build: test\nLearnings.\n")
    recordInputSource(buildDir, buildName, "/nonexistent/path/idea.md")

    vi.mocked(invokeClaude).mockResolvedValue({
      result: `${REFINED_HEADING}\n\nBody.\n`,
      success: true,
      durationMs: 1000,
      costUsd: 0.1,
      sessionId: "s1",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    })

    await runRetroRefine(buildName, opts)

    expect(fs.existsSync(path.join(buildDir, "refined-input.md"))).toBe(true)
    const callArgs = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(callArgs.userPrompt).toContain("could not be read")
  })
})
