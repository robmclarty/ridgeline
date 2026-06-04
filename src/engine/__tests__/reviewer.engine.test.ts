import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { RidgelineConfig, PhaseInfo } from "../../types.js"
import { cannedGenerateResult, stubEngine } from "../atoms/__tests__/_stub.engine.js"
import { reviewVerdictSchema } from "../schemas.js"

const { runClaudeProcessMock } = vi.hoisted(() => ({
  runClaudeProcessMock: vi.fn(async () => ({
    success: true,
    result: '{"passed":true,"summary":"ok","criteriaResults":[],"issues":[],"suggestions":[]}',
    durationMs: 5,
    costUsd: 0,
    usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    sessionId: "",
  })),
}))
vi.mock("../claude-process.js", () => ({ runClaudeProcess: runClaudeProcessMock }))
vi.mock("../../ui/claude-stream-display.js", () => ({
  createStreamDisplay: () => ({ onChunk: () => {}, flush: () => {} }),
  createLegacyStdoutDisplay: () => ({ onStdout: () => {}, flush: () => {} }),
}))
vi.mock("../discovery/agent.registry.js", () => ({
  buildAgentRegistry: () => ({ getCorePrompt: () => "REVIEWER SYSTEM" }),
}))
vi.mock("../git.js", () => ({ getDiff: () => "" }))
vi.mock("../stores/state.js", () => ({ getMatchedShapes: () => [] }))
vi.mock("../shapes/detect.js", () => ({ loadShapeDefinitions: () => [] }))
vi.mock("../legacy-shared.js", () => ({
  appendDesign: () => {},
  prepareAgentsAndPlugins: () => ({ agents: undefined, pluginDirs: [] }),
  commonInvokeOptions: () => ({ cwd: process.cwd(), onStdout: () => {} }),
}))

import { runReviewer } from "../reviewer.js"

describe("runReviewer — provider branch", () => {
  let tmp: string
  let config: RidgelineConfig
  let phase: PhaseInfo

  beforeEach(() => {
    vi.clearAllMocks()
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-reviewer-"))
    const buildDir = path.join(tmp, "build")
    fs.mkdirSync(buildDir, { recursive: true })
    fs.writeFileSync(path.join(tmp, "constraints.md"), "# Constraints")
    const phaseFile = path.join(buildDir, "01-scaffold.md")
    fs.writeFileSync(phaseFile, "# Phase 1")
    phase = { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: phaseFile, dependsOn: [] }
    config = {
      buildName: "test",
      ridgelineDir: tmp,
      buildDir,
      constraintsPath: path.join(tmp, "constraints.md"),
      tastePath: null,
      handoffPath: path.join(buildDir, "handoff.md"),
      phasesDir: buildDir,
      model: "openai:gpt-4o",
      maxRetries: 2,
      timeoutMinutes: 30,
      checkTimeoutSeconds: 1200,
      checkCommand: null,
      maxBudgetUsd: null,
      unsafe: false,
      sandboxMode: "off",
      sandboxExtras: { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
      networkAllowlist: [],
      extraContext: null,
      specialistCount: 2,
      specialistTimeoutSeconds: 180,
      phaseBudgetLimit: 15,
      phaseTokenLimit: 80000,
      sequencing: { kind: "sequential" },
    }
  })

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it("runs the engine path (schema + read-only tools) when an engine is supplied", async () => {
    const engine = stubEngine(
      cannedGenerateResult({ passed: true, summary: "looks good", criteriaResults: [], issues: [], suggestions: [] }),
    )

    const { verdict } = await runReviewer(config, phase, "checkpoint-tag", undefined, [], engine)

    expect(runClaudeProcessMock).not.toHaveBeenCalled()
    expect(engine.generate).toHaveBeenCalledTimes(1)
    const opts = engine.generate.mock.calls[0]![0]
    expect(opts.schema).toBe(reviewVerdictSchema)
    const toolNames = (opts.tools ?? []).map((t) => t.name)
    expect(toolNames).toContain("Read")
    expect(toolNames).not.toContain("Bash") // sandbox off → Bash dropped
    expect(verdict.passed).toBe(true)
    expect(verdict.summary).toBe("looks good")
  })

  it("runs the spawn path when no engine is supplied", async () => {
    const engine = stubEngine(cannedGenerateResult("ignored"))
    const { verdict } = await runReviewer(config, phase, "checkpoint-tag", undefined, [])
    expect(runClaudeProcessMock).toHaveBeenCalledTimes(1)
    expect(engine.generate).not.toHaveBeenCalled()
    expect(verdict.passed).toBe(true)
  })
})
