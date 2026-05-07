import { describe, it, expect, vi, beforeEach } from "vitest"
import { makeConfig, makePhase, makeClaudeResult } from "../../../../test/factories"

vi.mock("../../claude/claude.exec", () => ({
  invokeClaude: vi.fn(),
}))

vi.mock("../../discovery/agent.registry", () => ({
  buildAgentRegistry: vi.fn(() => ({
    getCorePrompt: vi.fn(() => "builder system prompt"),
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

vi.mock("../../../stores/handoff", () => ({
  readHandoff: vi.fn(() => null),
}))

vi.mock("../../discovery/plugin.scan", () => ({
  cleanupPluginDirs: vi.fn(),
}))

vi.mock("../pipeline.shared", () => ({
  prepareAgentsAndPlugins: vi.fn(() => ({ agents: undefined, pluginDirs: [] })),
  appendConstraintsAndTaste: vi.fn(),
  appendDesign: vi.fn(),
  appendAssetCatalog: vi.fn(),
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
    existsSync: vi.fn(() => false),
  }
})

import { invokeBuilder } from "../build.exec"
import { invokeClaude } from "../../claude/claude.exec"
import { buildAgentRegistry } from "../../discovery/agent.registry"
import { createDisplayCallbacks } from "../../claude/stream.display"
import { readHandoff } from "../../../stores/handoff"
import { cleanupPluginDirs } from "../../discovery/plugin.scan"
import * as fs from "node:fs"

beforeEach(() => vi.clearAllMocks())

describe("invokeBuilder", () => {
  it("calls invokeClaude with builder system prompt", async () => {
    const result = makeClaudeResult()
    vi.mocked(invokeClaude).mockResolvedValue(result)

    await invokeBuilder(makeConfig(), makePhase(), null)

    expect(buildAgentRegistry).toHaveBeenCalled()
    expect(invokeClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: "builder system prompt",
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent", "Skill"],
      }),
    )
  })

  it("includes phase spec in user prompt", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue("Phase 1: Scaffold the project")
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeBuilder(makeConfig(), makePhase(), null)

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).toContain("## Phase Spec")
    expect(call.userPrompt).toContain("Phase 1: Scaffold the project")
  })

  it("includes handoff section when handoff exists", async () => {
    vi.mocked(readHandoff).mockReturnValue("Previous phase notes")
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeBuilder(makeConfig(), makePhase(), null)

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).toContain("## handoff.md")
    expect(call.userPrompt).toContain("Previous phase notes")
  })

  it("omits handoff section when no handoff", async () => {
    vi.mocked(readHandoff).mockReturnValue("")
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeBuilder(makeConfig(), makePhase(), null)

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).not.toContain("## handoff.md")
  })

  it("includes check command when configured", async () => {
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeBuilder(makeConfig({ checkCommand: "npm test" }), makePhase(), null)

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).toContain("## Check Command")
    expect(call.userPrompt).toContain("npm test")
  })

  it("omits check command when not configured", async () => {
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeBuilder(makeConfig({ checkCommand: null }), makePhase(), null)

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).not.toContain("## Check Command")
  })

  it("includes handoff file path", async () => {
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeBuilder(makeConfig({ buildDir: "/my/build" }), makePhase(), null)

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).toContain("## Handoff File")
    expect(call.userPrompt).toContain("/my/build/handoff.md")
  })

  it("routes the handoff path to a per-phase fragment when cwd is a worktree", async () => {
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeBuilder(
      makeConfig({ buildName: "improve", buildDir: "/main/.ridgeline/builds/improve" }),
      makePhase({ id: "04-dashboard" }),
      null,
      "/wt/improve/04-dashboard",
    )

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).toContain("## Handoff File")
    expect(call.userPrompt).toContain("/wt/improve/04-dashboard/.ridgeline/builds/improve/handoff-04-dashboard.md")
    expect(call.userPrompt).not.toContain("/main/.ridgeline/builds/improve/handoff.md")
  })

  it("includes reviewer feedback when feedbackPath exists", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes("feedback"))
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p).includes("feedback")) return "Fix the broken test"
      return "phase spec"
    })
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeBuilder(makeConfig(), makePhase(), "/tmp/feedback.md")

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).toContain("## Reviewer Feedback (RETRY)")
    expect(call.userPrompt).toContain("Fix the broken test")
  })

  it("omits feedback section when feedbackPath is null", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeBuilder(makeConfig(), makePhase(), null)

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).not.toContain("## Reviewer Feedback")
  })

  it("returns the ClaudeResult", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const expected = makeClaudeResult({ result: "built successfully" })
    vi.mocked(invokeClaude).mockResolvedValue(expected)

    const result = await invokeBuilder(makeConfig(), makePhase(), null)
    expect(result).toBe(expected)
  })

  it("calls flush and cleanupPluginDirs in finally block", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const flush = vi.fn()
    vi.mocked(createDisplayCallbacks).mockReturnValue({ onStdout: vi.fn(), flush })
    vi.mocked(invokeClaude).mockRejectedValue(new Error("claude failed"))

    await expect(invokeBuilder(makeConfig(), makePhase(), null)).rejects.toThrow("claude failed")

    expect(flush).toHaveBeenCalled()
    expect(cleanupPluginDirs).toHaveBeenCalled()
  })

  it("includes the cross-phase discoveries path in the user prompt", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(invokeClaude).mockResolvedValue(makeClaudeResult())

    await invokeBuilder(makeConfig({ buildDir: "/main/.ridgeline/builds/myapp" }), makePhase(), null)

    const call = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(call.userPrompt).toContain("## Cross-Phase Discoveries")
    expect(call.userPrompt).toContain("/main/.ridgeline/builds/myapp/discoveries.jsonl")
    expect(call.userPrompt).toContain("Log is currently empty.")
  })
})
