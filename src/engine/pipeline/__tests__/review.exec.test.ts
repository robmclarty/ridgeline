import { describe, it, expect, vi, beforeEach } from "vitest"
import { makeConfig, makePhase, makeClaudeResult, passVerdict } from "../../../../test/factories"

vi.mock("../../claude/claude.exec", () => ({
  invokeClaude: vi.fn(),
}))

vi.mock("../../discovery/agent.registry", () => ({
  buildAgentRegistry: vi.fn(() => ({
    getCorePrompt: vi.fn(() => "reviewer system prompt"),
    getSpecialists: vi.fn(() => []),
    getSpecialist: vi.fn(() => null),
    getContext: vi.fn(() => null),
    getGaps: vi.fn(() => null),
    getSubAgents: vi.fn(() => []),
    getAgentsFlag: vi.fn(() => ({})),
  })),
}))

vi.mock("../../claude/stream.display", () => ({
  createDisplayCallbacks: vi.fn(() => ({ onStdout: vi.fn(), flush: vi.fn() })),
}))

vi.mock("../../../git", () => ({
  getDiff: vi.fn(() => "diff --git a/file.ts"),
}))

vi.mock("../../../stores/feedback.verdict", () => ({
  parseVerdict: vi.fn(() => ({
    passed: true,
    summary: "All good",
    criteriaResults: [],
    issues: [],
    suggestions: [],
  })),
}))

vi.mock("../../discovery/plugin.scan", () => ({
  cleanupPluginDirs: vi.fn(),
}))

vi.mock("../../../stores/state", () => ({
  getMatchedShapes: vi.fn(() => []),
}))

vi.mock("../../../shapes/detect", () => ({
  loadShapeDefinitions: vi.fn(() => []),
}))

vi.mock("../pipeline.shared", () => ({
  prepareAgentsAndPlugins: vi.fn(() => ({ agents: undefined, pluginDirs: [] })),
  appendDesign: vi.fn(),
  commonInvokeOptions: vi.fn(() => ({
    agents: undefined,
    pluginDirs: undefined,
    cwd: "/tmp",
    timeoutMs: 7200000,
    onStdout: vi.fn(),
    onStderr: vi.fn(),
    sandboxProvider: null,
    networkAllowlist: [],
    additionalWritePaths: ["/tmp/build"],
  })),
}))

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    readFileSync: vi.fn(() => "phase spec content"),
  }
})

import { invokeReviewer } from "../review.exec"
import { invokeClaude } from "../../claude/claude.exec"
import { buildAgentRegistry } from "../../discovery/agent.registry"
import { createDisplayCallbacks } from "../../claude/stream.display"
import { getDiff } from "../../../git"
import { parseVerdict } from "../../../stores/feedback.verdict"
import { cleanupPluginDirs } from "../../discovery/plugin.scan"
import { appendDesign } from "../pipeline.shared"
import { getMatchedShapes } from "../../../stores/state"
import { loadShapeDefinitions } from "../../../shapes/detect"

beforeEach(() => vi.clearAllMocks())

describe("invokeReviewer", () => {
  it("calls invokeClaude with reviewer system prompt", async () => {
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeReviewer(makeConfig(), makePhase(), "checkpoint-tag")

    expect(buildAgentRegistry).toHaveBeenCalled()
    expect(invokeClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: "reviewer system prompt",
        allowedTools: ["Read", "Bash", "Glob", "Grep", "Agent", "Skill"],
      }),
    )
  })

  it("does not include Write or Edit in allowed tools", async () => {
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeReviewer(makeConfig(), makePhase(), "checkpoint-tag")

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.allowedTools).not.toContain("Write")
    expect(call.allowedTools).not.toContain("Edit")
  })

  it("includes phase spec in user prompt", async () => {
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeReviewer(makeConfig(), makePhase(), "checkpoint-tag")

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).toContain("## Phase Spec")
    expect(call.userPrompt).toContain("phase spec content")
  })

  it("includes git diff when changes exist", async () => {
    vi.mocked(getDiff).mockReturnValue("diff --git a/file.ts\n+new line")
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeReviewer(makeConfig(), makePhase(), "checkpoint-tag")

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).toContain("## Git Diff")
    expect(call.userPrompt).toContain("```diff")
    expect(call.userPrompt).toContain("diff --git a/file.ts")
  })

  it("shows 'No changes detected' when diff is empty", async () => {
    vi.mocked(getDiff).mockReturnValue("")
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeReviewer(makeConfig(), makePhase(), "checkpoint-tag")

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).toContain("No changes detected")
  })

  it("includes constraints section", async () => {
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeReviewer(makeConfig(), makePhase(), "checkpoint-tag")

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).toContain("## constraints.md")
  })

  it("calls parseVerdict on the result text", async () => {
    const result = makeClaudeResult({ result: "verdict json here" })
    vi.mocked(invokeClaude).mockResolvedValue(result)

    await invokeReviewer(makeConfig(), makePhase(), "checkpoint-tag")

    expect(parseVerdict).toHaveBeenCalledWith("verdict json here")
  })

  it("returns both result and verdict", async () => {
    const result = makeClaudeResult()
    vi.mocked(invokeClaude).mockResolvedValue(result)
    vi.mocked(parseVerdict).mockReturnValue(passVerdict)

    const output = await invokeReviewer(makeConfig(), makePhase(), "checkpoint-tag")

    expect(output.result).toBe(result)
    expect(output.verdict).toEqual({ ...passVerdict, sensorFindings: [] })
  })

  it("calls appendDesign with the config", async () => {
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    const config = makeConfig()
    await invokeReviewer(config, makePhase(), "checkpoint-tag")

    const { PromptDocument } = await import("../prompt.document")
    expect(appendDesign).toHaveBeenCalledWith(expect.any(PromptDocument), config)
  })

  it("includes visual review context when shapes matched", async () => {
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())
    vi.mocked(getMatchedShapes).mockReturnValue(["web-visual"])
    vi.mocked(loadShapeDefinitions).mockReturnValue([
      {
        name: "web-visual",
        keywords: ["web", "browser"],
        reviewerContext: "Check responsive behavior at mobile/tablet/desktop viewports.",
      },
    ])

    await invokeReviewer(makeConfig(), makePhase(), "checkpoint-tag")

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).toContain("## Visual Design Review Context")
    expect(call.userPrompt).toContain("Check responsive behavior at mobile/tablet/desktop viewports.")
  })

  it("calls flush and cleanupPluginDirs in finally block", async () => {
    const flush = vi.fn()
    vi.mocked(createDisplayCallbacks).mockReturnValue({ onStdout: vi.fn(), flush })
    vi.mocked(invokeClaude).mockRejectedValue(new Error("claude failed"))

    await expect(
      invokeReviewer(makeConfig(), makePhase(), "checkpoint-tag"),
    ).rejects.toThrow("claude failed")

    expect(flush).toHaveBeenCalled()
    expect(cleanupPluginDirs).toHaveBeenCalled()
  })
})
