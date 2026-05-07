import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup.js"
import type { RidgelineConfig } from "../../types.js"

vi.mock("../../ui/output.js", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
  printPhaseHeader: vi.fn(),
}))

vi.mock("../../stores/trajectory.js", () => ({
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

vi.mock("../../stores/phases.js", () => ({
  scanPhases: vi.fn(() => []),
}))

vi.mock("../../engine/pipeline/phase.sequence.js", () => ({
  runPhase: vi.fn(),
}))

vi.mock("../../stores/state.js", () => ({
  loadState: vi.fn(() => null),
  saveState: vi.fn(),
  initState: vi.fn((name, phases) => ({
    buildName: name,
    startedAt: "2024-01-01T00:00:00.000Z",
    pipeline: { shape: "pending", design: "pending", spec: "pending", research: "pending", refine: "pending", plan: "pending", build: "pending" },
    phases: phases.map((p: any) => ({
      id: p.id,
      status: "pending",
      checkpointTag: `ridgeline/checkpoint/${name}/${p.id}`,
      completionTag: null,
      retries: 0,
      duration: null,
      completedAt: null,
      failedAt: null,
    })),
  })),
  resetRetries: vi.fn(),
  reconcilePhases: vi.fn(() => ({ added: [], removed: [] })),
  markBuildRunning: vi.fn(),
  advancePipeline: vi.fn(),
}))

vi.mock("../../stores/budget.js", () => ({
  loadBudget: vi.fn(() => ({ entries: [], totalCostUsd: 0 })),
}))

vi.mock("../../stores/tags.js", () => ({
  cleanupBuildTags: vi.fn(),
}))

vi.mock("../plan.js", () => ({
  runPlan: vi.fn(),
}))

vi.mock("../../engine/claude/sandbox.js", () => ({
  detectSandbox: vi.fn(() => ({ provider: null, warning: null })),
}))

vi.mock("../../engine/worktree.js", () => ({
  ensureGitRepo: vi.fn(() => false),
}))

import { runBuild } from "../build.js"
import { scanPhases } from "../../stores/phases.js"
import { runPhase } from "../../engine/pipeline/phase.sequence.js"
import { loadState, resetRetries } from "../../stores/state.js"
import { loadBudget } from "../../stores/budget.js"
import { detectSandbox } from "../../engine/claude/sandbox.js"
import { printInfo } from "../../ui/output.js"

describe("commands/run", () => {
  let tmpDir: string
  let config: RidgelineConfig
  let origExit: typeof process.exit

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})
    tmpDir = makeTempDir()

    config = {
      buildName: "test",
      ridgelineDir: tmpDir,
      buildDir: tmpDir,
      constraintsPath: path.join(tmpDir, "constraints.md"),
      tastePath: null,
      handoffPath: path.join(tmpDir, "handoff.md"),
      phasesDir: path.join(tmpDir, "phases"),
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
      requirePhaseApproval: false,
    }

    // Mock process.exit to throw instead of exiting
    origExit = process.exit.bind(process)
    process.exit = vi.fn(() => { throw new Error("process.exit") }) as any
  })

  afterEach(() => {
    process.exit = origExit
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("throws when no phases and planner generates none", async () => {
    vi.mocked(scanPhases).mockReturnValue([])

    await expect(runBuild(config)).rejects.toThrow("No phases generated")
  })

  it("runs phases sequentially until all complete", async () => {
    const phases = [
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/p/01-scaffold.md", dependsOn: [] },
      { id: "02-api", index: 2, slug: "api", filename: "02-api.md", filepath: "/p/02-api.md", dependsOn: [] },
    ]

    vi.mocked(scanPhases).mockReturnValue(phases)
    vi.mocked(runPhase).mockResolvedValue("passed")

    await runBuild(config)
    expect(runPhase).toHaveBeenCalledTimes(2)
  })

  it("halts on first phase failure", async () => {
    const phases = [
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/p/01-scaffold.md", dependsOn: [] },
      { id: "02-api", index: 2, slug: "api", filename: "02-api.md", filepath: "/p/02-api.md", dependsOn: [] },
    ]

    vi.mocked(scanPhases).mockReturnValue(phases)
    vi.mocked(runPhase).mockResolvedValue("failed")

    try {
      await runBuild(config)
    } catch {
      // process.exit throws
    }

    expect(runPhase).toHaveBeenCalledTimes(1)
  })

  it("calls resetRetries and prints resume message when state exists", async () => {
    const phases = [
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/p/01-scaffold.md", dependsOn: [] },
    ]

    vi.mocked(scanPhases).mockReturnValue(phases)
    vi.mocked(loadState).mockReturnValue({
      buildName: "test",
      startedAt: "2024-01-01T00:00:00.000Z",
      pipeline: { shape: "complete", design: "skipped", spec: "complete", research: "skipped", refine: "skipped", plan: "complete", build: "pending" },
      phases: [{ id: "01-scaffold", status: "failed", checkpointTag: "", completionTag: null, retries: 1, duration: null, completedAt: null, failedAt: "2024-01-01" }],
    })
    vi.mocked(runPhase).mockResolvedValue("passed")

    await runBuild(config)

    expect(resetRetries).toHaveBeenCalled()
    expect(printInfo).toHaveBeenCalledWith(expect.stringContaining("Resuming build"))
  })

  it("breaks when budget is exceeded", async () => {
    const phases = [
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/p/01-scaffold.md", dependsOn: [] },
      { id: "02-api", index: 2, slug: "api", filename: "02-api.md", filepath: "/p/02-api.md", dependsOn: [] },
    ]

    vi.mocked(scanPhases).mockReturnValue(phases)
    vi.mocked(runPhase).mockResolvedValue("passed")

    // After first phase, budget exceeds limit
    vi.mocked(loadBudget).mockReturnValue({ entries: [], totalCostUsd: 15.00 })

    config.maxBudgetUsd = 10.00
    await runBuild(config)

    // Only ran first phase because budget exceeded after it
    expect(runPhase).toHaveBeenCalledTimes(1)
    expect(printInfo).toHaveBeenCalledWith(expect.stringContaining("Budget limit reached"))
  })

  it("skips sandbox detection when sandboxMode is 'off'", async () => {
    const phases = [
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/p/01-scaffold.md", dependsOn: [] },
    ]

    vi.mocked(scanPhases).mockReturnValue(phases)
    vi.mocked(runPhase).mockResolvedValue("passed")
    vi.mocked(loadBudget).mockReturnValue({ entries: [], totalCostUsd: 0 })

    config.unsafe = true
    config.sandboxMode = "off"
    try { await runBuild(config) } catch { /* process.exit mock throws */ }

    expect(detectSandbox).not.toHaveBeenCalled()
  })

})
