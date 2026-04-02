import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import type { RidgelineConfig, BuildState } from "../../types"

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

vi.mock("../../state/stateManager", () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
  initState: vi.fn(),
  getNextIncompletePhase: vi.fn(),
}))

vi.mock("../../runner/planInvoker", () => ({
  scanPhases: vi.fn(() => []),
}))

vi.mock("../run", () => ({
  runBuild: vi.fn(),
}))

import { runResume } from "../resume"
import { loadState } from "../../state/stateManager"
import { scanPhases } from "../../runner/planInvoker"
import { runBuild } from "../run"

describe("commands/resume", () => {
  let tmpDir: string
  let config: RidgelineConfig
  let origExit: typeof process.exit

  beforeEach(() => {
    vi.clearAllMocks()
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
      timeoutMinutes: 30,
      verbose: false,
      checkCommand: null,
      maxBudgetUsd: null,
    }

    origExit = process.exit
    process.exit = vi.fn(() => { throw new Error("process.exit") }) as any
  })

  afterEach(() => {
    process.exit = origExit
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("exits when no state found", async () => {
    vi.mocked(loadState).mockReturnValue(null)

    try {
      await runResume(config)
    } catch {
      // process.exit throws
    }

    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it("exits when no phase files found", async () => {
    vi.mocked(loadState).mockReturnValue({
      buildName: "test",
      startedAt: "2024-01-01T00:00:00.000Z",
      phases: [{ id: "01-scaffold", status: "complete", checkpointTag: "", completionTag: "tag", retries: 0, duration: null, completedAt: null, failedAt: null }],
    })
    vi.mocked(scanPhases).mockReturnValue([])

    try {
      await runResume(config)
    } catch {
      // process.exit throws
    }

    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it("delegates to runBuild when state and phases exist", async () => {
    vi.mocked(loadState).mockReturnValue({
      buildName: "test",
      startedAt: "2024-01-01T00:00:00.000Z",
      phases: [
        { id: "01-scaffold", status: "complete", checkpointTag: "", completionTag: "tag", retries: 0, duration: null, completedAt: null, failedAt: null },
        { id: "02-api", status: "pending", checkpointTag: "", completionTag: null, retries: 0, duration: null, completedAt: null, failedAt: null },
      ],
    })
    vi.mocked(scanPhases).mockReturnValue([
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/p/01.md" },
      { id: "02-api", index: 2, slug: "api", filename: "02-api.md", filepath: "/p/02.md" },
    ])

    await runResume(config)
    expect(runBuild).toHaveBeenCalledWith(config)
  })
})
