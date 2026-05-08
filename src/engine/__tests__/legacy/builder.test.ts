import { describe, it, expect, vi, beforeEach } from "vitest"
import { makeConfig, makePhase, makeClaudeResult } from "../../../../test/factories.js"

vi.mock("../../claude-process.js", () => ({
  runClaudeProcess: vi.fn(),
}))

vi.mock("../../discovery/agent.registry.js", () => ({
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

vi.mock("../../../ui/claude-stream-display.js", () => ({
  createLegacyStdoutDisplay: vi.fn(() => ({ onStdout: vi.fn(), flush: vi.fn() })),
}))

vi.mock("../../../stores/handoff.js", () => ({
  readHandoff: vi.fn(() => null),
}))

vi.mock("../../discovery/plugin.scan.js", () => ({
  cleanupPluginDirs: vi.fn(),
  discoverPluginDirs: vi.fn(() => []),
}))

vi.mock("../../legacy-shared.js", () => ({
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

import { runBuilder } from "../../builder.js"
import { runClaudeProcess } from "../../claude-process.js"
import { buildAgentRegistry } from "../../discovery/agent.registry.js"
import { createLegacyStdoutDisplay } from "../../../ui/claude-stream-display.js"
import { readHandoff } from "../../../stores/handoff.js"
import { cleanupPluginDirs } from "../../discovery/plugin.scan.js"
import * as fs from "node:fs"

beforeEach(() => vi.clearAllMocks())

describe("runBuilder", () => {
  it("calls runClaudeProcess with builder system prompt", async () => {
    const result = makeClaudeResult()
    vi.mocked(runClaudeProcess).mockResolvedValue(result)

    await runBuilder(makeConfig(), makePhase(), null)

    expect(buildAgentRegistry).toHaveBeenCalled()
    expect(runClaudeProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: "builder system prompt",
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent", "Skill"],
      }),
    )
  })

  it("includes phase spec in user prompt", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue("Phase 1: Scaffold the project")
    vi.mocked(runClaudeProcess).mockResolvedValue(makeClaudeResult())

    await runBuilder(makeConfig(), makePhase(), null)

    const call = vi.mocked(runClaudeProcess).mock.calls[0][0]
    expect(call.userPrompt).toContain("## Phase Spec")
    expect(call.userPrompt).toContain("Phase 1: Scaffold the project")
  })

  it("includes handoff section when handoff exists", async () => {
    vi.mocked(readHandoff).mockReturnValue("Previous phase notes")
    vi.mocked(runClaudeProcess).mockResolvedValue(makeClaudeResult())

    await runBuilder(makeConfig(), makePhase(), null)

    const call = vi.mocked(runClaudeProcess).mock.calls[0][0]
    expect(call.userPrompt).toContain("## handoff.md")
    expect(call.userPrompt).toContain("Previous phase notes")
  })

  it("omits handoff section when no handoff", async () => {
    vi.mocked(readHandoff).mockReturnValue("")
    vi.mocked(runClaudeProcess).mockResolvedValue(makeClaudeResult())

    await runBuilder(makeConfig(), makePhase(), null)

    const call = vi.mocked(runClaudeProcess).mock.calls[0][0]
    expect(call.userPrompt).not.toContain("## handoff.md")
  })

  it("includes check command when configured", async () => {
    vi.mocked(runClaudeProcess).mockResolvedValue(makeClaudeResult())

    await runBuilder(makeConfig({ checkCommand: "npm test" }), makePhase(), null)

    const call = vi.mocked(runClaudeProcess).mock.calls[0][0]
    expect(call.userPrompt).toContain("## Check Command")
    expect(call.userPrompt).toContain("npm test")
  })

  it("omits check command when not configured", async () => {
    vi.mocked(runClaudeProcess).mockResolvedValue(makeClaudeResult())

    await runBuilder(makeConfig({ checkCommand: null }), makePhase(), null)

    const call = vi.mocked(runClaudeProcess).mock.calls[0][0]
    expect(call.userPrompt).not.toContain("## Check Command")
  })

  it("includes handoff file path", async () => {
    vi.mocked(runClaudeProcess).mockResolvedValue(makeClaudeResult())

    await runBuilder(makeConfig({ buildDir: "/my/build" }), makePhase(), null)

    const call = vi.mocked(runClaudeProcess).mock.calls[0][0]
    expect(call.userPrompt).toContain("## Handoff File")
    expect(call.userPrompt).toContain("/my/build/handoff.md")
  })

  it("routes the handoff path to a per-phase fragment when cwd is a worktree", async () => {
    vi.mocked(runClaudeProcess).mockResolvedValue(makeClaudeResult())

    await runBuilder(
      makeConfig({ buildName: "improve", buildDir: "/main/.ridgeline/builds/improve" }),
      makePhase({ id: "04-dashboard" }),
      null,
      "/wt/improve/04-dashboard",
    )

    const call = vi.mocked(runClaudeProcess).mock.calls[0][0]
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
    vi.mocked(runClaudeProcess).mockResolvedValue(makeClaudeResult())

    await runBuilder(makeConfig(), makePhase(), "/tmp/feedback.md")

    const call = vi.mocked(runClaudeProcess).mock.calls[0][0]
    expect(call.userPrompt).toContain("## Reviewer Feedback (RETRY)")
    expect(call.userPrompt).toContain("Fix the broken test")
  })

  it("omits feedback section when feedbackPath is null", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(runClaudeProcess).mockResolvedValue(makeClaudeResult())

    await runBuilder(makeConfig(), makePhase(), null)

    const call = vi.mocked(runClaudeProcess).mock.calls[0][0]
    expect(call.userPrompt).not.toContain("## Reviewer Feedback")
  })

  it("returns the ClaudeResult", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const expected = makeClaudeResult({ result: "built successfully" })
    vi.mocked(runClaudeProcess).mockResolvedValue(expected)

    const result = await runBuilder(makeConfig(), makePhase(), null)
    expect(result).toBe(expected)
  })

  it("calls flush and cleanupPluginDirs in finally block", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const flush = vi.fn()
    vi.mocked(createLegacyStdoutDisplay).mockReturnValue({ onStdout: vi.fn(), flush })
    vi.mocked(runClaudeProcess).mockRejectedValue(new Error("claude failed"))

    await expect(runBuilder(makeConfig(), makePhase(), null)).rejects.toThrow("claude failed")

    expect(flush).toHaveBeenCalled()
    expect(cleanupPluginDirs).toHaveBeenCalled()
  })

  it("includes the cross-phase discoveries path in the user prompt", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(runClaudeProcess).mockResolvedValue(makeClaudeResult())

    await runBuilder(makeConfig({ buildDir: "/main/.ridgeline/builds/myapp" }), makePhase(), null)

    const call = vi.mocked(runClaudeProcess).mock.calls[0][0]
    expect(call.userPrompt).toContain("## Cross-Phase Discoveries")
    expect(call.userPrompt).toContain("/main/.ridgeline/builds/myapp/discoveries.jsonl")
    expect(call.userPrompt).toContain("Log is currently empty.")
  })
})
