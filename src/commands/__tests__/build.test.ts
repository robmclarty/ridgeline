import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import type { RidgelineConfig } from "../../types"

vi.mock("../../logging", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
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

vi.mock("../../runner/planInvoker", () => ({
  scanPhases: vi.fn(() => []),
}))

vi.mock("../../runner/phaseRunner", () => ({
  runPhase: vi.fn(),
}))

vi.mock("../../state/stateManager", () => ({
  loadState: vi.fn(() => null),
  saveState: vi.fn(),
  initState: vi.fn((name, phases) => ({
    buildName: name,
    startedAt: "2024-01-01T00:00:00.000Z",
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
  getNextIncompletePhase: vi.fn(),
  resetRetries: vi.fn(),
}))

vi.mock("../../state/budget", () => ({
  loadBudget: vi.fn(() => ({ entries: [], totalCostUsd: 0 })),
}))

vi.mock("../../git", () => ({
  deleteTagsByPrefix: vi.fn(),
}))

vi.mock("../plan", () => ({
  runPlan: vi.fn(),
}))

import { runBuild } from "../build"
import { scanPhases } from "../../runner/planInvoker"
import { runPhase } from "../../runner/phaseRunner"
import { getNextIncompletePhase } from "../../state/stateManager"

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
      buildDir: tmpDir,
      constraintsPath: path.join(tmpDir, "constraints.md"),
      tastePath: null,
      snapshotPath: path.join(tmpDir, "snapshot.md"),
      handoffPath: path.join(tmpDir, "handoff.md"),
      phasesDir: path.join(tmpDir, "phases"),
      model: "opus",
      maxRetries: 2,
      timeoutMinutes: 120,
      checkTimeoutSeconds: 1200,
      checkCommand: null,
      maxBudgetUsd: null,
    }

    // Mock process.exit to throw instead of exiting
    origExit = process.exit
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
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/p/01-scaffold.md" },
      { id: "02-api", index: 2, slug: "api", filename: "02-api.md", filepath: "/p/02-api.md" },
    ]

    vi.mocked(scanPhases).mockReturnValue(phases)
    vi.mocked(runPhase).mockResolvedValue("passed")

    // Simulate getNextIncompletePhase returning each phase then null
    vi.mocked(getNextIncompletePhase)
      .mockReturnValueOnce({ id: "01-scaffold", status: "pending", checkpointTag: "", completionTag: null, retries: 0, duration: null, completedAt: null, failedAt: null })
      .mockReturnValueOnce({ id: "02-api", status: "pending", checkpointTag: "", completionTag: null, retries: 0, duration: null, completedAt: null, failedAt: null })
      .mockReturnValueOnce(null)

    await runBuild(config)
    expect(runPhase).toHaveBeenCalledTimes(2)
  })

  it("halts on first phase failure", async () => {
    const phases = [
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/p/01-scaffold.md" },
      { id: "02-api", index: 2, slug: "api", filename: "02-api.md", filepath: "/p/02-api.md" },
    ]

    vi.mocked(scanPhases).mockReturnValue(phases)
    vi.mocked(runPhase).mockResolvedValue("failed")
    vi.mocked(getNextIncompletePhase)
      .mockReturnValueOnce({ id: "01-scaffold", status: "pending", checkpointTag: "", completionTag: null, retries: 0, duration: null, completedAt: null, failedAt: null })

    try {
      await runBuild(config)
    } catch {
      // process.exit throws
    }

    expect(runPhase).toHaveBeenCalledTimes(1)
  })
})
