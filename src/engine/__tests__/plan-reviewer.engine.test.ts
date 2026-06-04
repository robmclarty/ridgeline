import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { RidgelineConfig } from "../../types.js"
import { cannedGenerateResult, stubEngine } from "../atoms/__tests__/_stub.engine.js"
import { planReviewSchema } from "../schemas.js"

// Isolate the leaf transports and the UI display from the test.
const { runClaudeProcessMock } = vi.hoisted(() => ({
  runClaudeProcessMock: vi.fn(async () => ({
    success: true,
    result: '{"approved":true,"issues":[]}',
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
  buildAgentRegistry: () => ({ getCorePrompt: () => "PLAN REVIEWER SYSTEM" }),
}))

import { runPlanReviewer } from "../plan-reviewer.js"

describe("runPlanReviewer — provider branch", () => {
  let tmp: string
  let config: RidgelineConfig
  const savedKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ANTHROPIC_API_KEY
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-plan-reviewer-"))
    const buildDir = path.join(tmp, "build")
    const phasesDir = path.join(buildDir, "phases")
    fs.mkdirSync(phasesDir, { recursive: true })
    fs.writeFileSync(path.join(buildDir, "spec.md"), "# Spec")
    fs.writeFileSync(path.join(tmp, "constraints.md"), "# Constraints")
    fs.writeFileSync(path.join(phasesDir, "01-scaffold.md"), "# Phase 1\n\n## Acceptance Criteria\n- a")
    config = {
      buildName: "test",
      ridgelineDir: tmp,
      buildDir,
      constraintsPath: path.join(tmp, "constraints.md"),
      tastePath: null,
      handoffPath: path.join(buildDir, "handoff.md"),
      phasesDir,
      model: "opus",
      maxRetries: 2,
      timeoutMinutes: 120,
      checkTimeoutSeconds: 1200,
      checkCommand: null,
      maxBudgetUsd: null,
      unsafe: false,
      sandboxMode: "semi-locked",
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

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = savedKey
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const setProvider = (provider?: string): void => {
    fs.writeFileSync(path.join(tmp, "settings.json"), JSON.stringify(provider ? { provider } : {}))
  }

  it("routes a non-Claude provider through the engine with schema validation", async () => {
    setProvider("openai")
    const engine = stubEngine(cannedGenerateResult({ approved: false, issues: ["phase too big"] }))

    const { verdict } = await runPlanReviewer(config, engine)

    expect(engine.generate).toHaveBeenCalledTimes(1)
    expect(runClaudeProcessMock).not.toHaveBeenCalled()
    const opts = engine.generate.mock.calls[0]![0]
    expect(opts.schema).toBe(planReviewSchema)
    expect(opts.tools).toBeUndefined()
    expect(verdict).toEqual({ approved: false, issues: ["phase too big"] })
  })

  it("routes claude_cli through the byte-stable spawn path (engine untouched)", async () => {
    setProvider() // no provider, no ANTHROPIC key → claude_cli
    const engine = stubEngine(cannedGenerateResult({ approved: false, issues: ["ignored"] }))

    const { verdict } = await runPlanReviewer(config, engine)

    expect(runClaudeProcessMock).toHaveBeenCalledTimes(1)
    expect(engine.generate).not.toHaveBeenCalled()
    expect(verdict).toEqual({ approved: true, issues: [] })
  })

  it("falls back to approved when the engine output is malformed", async () => {
    setProvider("openai")
    const engine = stubEngine(cannedGenerateResult("not json"))

    const { verdict } = await runPlanReviewer(config, engine)

    expect(verdict).toEqual({ approved: true, issues: [] })
  })
})
