import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import type { RidgelineConfig, ClaudeResult, PhaseInfo, EnsembleResult } from "../../types"

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
}))

vi.mock("../../store/trajectory", () => ({
  logTrajectory: vi.fn(),
  makeTrajectoryEntry: vi.fn(() => ({
    timestamp: "2024-01-01T00:00:00.000Z",
    type: "plan_start",
    phaseId: null,
    duration: null,
    tokens: null,
    costUsd: null,
    summary: "",
  })),
}))

vi.mock("../../store/budget", () => ({
  recordCost: vi.fn(),
}))

vi.mock("../../engine/pipeline/ensemble.exec", () => ({
  invokePlanner: vi.fn(),
}))

import { runPlan } from "../plan"
import { invokePlanner } from "../../engine/pipeline/ensemble.exec"

const makeResult = (): ClaudeResult => ({
  success: true,
  result: "ok",
  durationMs: 5000,
  costUsd: 0.50,
  usage: { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  sessionId: "sess",
})

describe("commands/plan", () => {
  let tmpDir: string
  let config: RidgelineConfig

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = makeTempDir()

    const buildDir = path.join(tmpDir, "build")
    const phasesDir = path.join(buildDir, "phases")
    fs.mkdirSync(phasesDir, { recursive: true })

    config = {
      buildName: "test",
      buildDir,
      constraintsPath: path.join(tmpDir, "constraints.md"),
      tastePath: null,
      handoffPath: path.join(buildDir, "handoff.md"),
      phasesDir,
      model: "opus",
      maxRetries: 2,
      timeoutMinutes: 120,
      checkTimeoutSeconds: 1200,
      checkCommand: null,
      maxBudgetUsd: null,
    }
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("throws when spec.md is missing", async () => {
    fs.writeFileSync(config.constraintsPath, "constraints")

    await expect(runPlan(config)).rejects.toThrow("spec.md not found")
  })

  it("throws when constraints.md is missing", async () => {
    fs.writeFileSync(path.join(config.buildDir, "spec.md"), "spec")

    await expect(runPlan(config)).rejects.toThrow("constraints.md not found")
  })

  it("invokes planner when inputs exist", async () => {
    fs.writeFileSync(path.join(config.buildDir, "spec.md"), "spec")
    fs.writeFileSync(config.constraintsPath, "constraints")

    const phases: PhaseInfo[] = [
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: path.join(config.phasesDir, "01-scaffold.md") },
    ]

    // Create the phase file so readFileSync in the summary works
    fs.writeFileSync(phases[0].filepath, "# Scaffold\n\nSetup the project")

    const synthResult = makeResult()
    const ensemble: EnsembleResult = {
      specialistResults: [makeResult(), makeResult(), makeResult()],
      synthesizerResult: synthResult,
      totalCostUsd: 2.00,
      totalDurationMs: 15000,
    }

    vi.mocked(invokePlanner).mockResolvedValue({
      result: synthResult,
      phases,
      ensemble,
    })

    await runPlan(config)
    expect(invokePlanner).toHaveBeenCalledWith(config)
  })
})
