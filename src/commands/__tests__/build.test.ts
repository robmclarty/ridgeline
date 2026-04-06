import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import type { RidgelineConfig } from "../../types"

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
  printPhaseHeader: vi.fn(),
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

vi.mock("../../store/phases", () => ({
  scanPhases: vi.fn(() => []),
}))

vi.mock("../../engine/pipeline/phase.sequence", () => ({
  runPhase: vi.fn(),
}))

vi.mock("../../store/state", () => ({
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
      isMerged: false,
      retries: 0,
      duration: null,
      completedAt: null,
      failedAt: null,
    })),
  })),
  getNextIncompletePhase: vi.fn(),
  getNextUnmergedPhase: vi.fn(() => null),
  resetRetries: vi.fn(),
  updatePhaseStatus: vi.fn(),
}))

vi.mock("../../store/budget", () => ({
  loadBudget: vi.fn(() => ({ entries: [], totalCostUsd: 0 })),
}))

vi.mock("../../store/tags", () => ({
  cleanupBuildTags: vi.fn(),
}))

vi.mock("../plan", () => ({
  runPlan: vi.fn(),
}))

vi.mock("../../engine/claude/sandbox", () => ({
  detectSandbox: vi.fn(() => ({ provider: null, warning: null })),
}))

vi.mock("../../git", () => ({
  isWorkingTreeDirty: vi.fn(() => false),
  commitAll: vi.fn(),
}))

vi.mock("../../engine/worktree", () => ({
  createWorktree: vi.fn(() => "/tmp/worktree"),
  validateWorktree: vi.fn(() => false),
  reflectCommits: vi.fn(),
  removeWorktree: vi.fn(),
  worktreePath: vi.fn(() => "/tmp/worktree"),
  cleanAllWorktrees: vi.fn(),
  ensureGitRepo: vi.fn(() => false),
}))

import { runBuild } from "../build"
import { scanPhases } from "../../store/phases"
import { runPhase } from "../../engine/pipeline/phase.sequence"
import { getNextIncompletePhase, getNextUnmergedPhase, loadState, resetRetries } from "../../store/state"
import { loadBudget } from "../../store/budget"
import { detectSandbox } from "../../engine/claude/sandbox"
import { printInfo } from "../../ui/output"
import { reflectCommits, removeWorktree, validateWorktree } from "../../engine/worktree"
import { cleanupBuildTags } from "../../store/tags"

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
      networkAllowlist: [],
      worktreePath: null,
      extraContext: null,
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
      .mockReturnValueOnce({ id: "01-scaffold", status: "pending", checkpointTag: "", completionTag: null, isMerged: false, retries: 0, duration: null, completedAt: null, failedAt: null })
      .mockReturnValueOnce({ id: "02-api", status: "pending", checkpointTag: "", completionTag: null, isMerged: false, retries: 0, duration: null, completedAt: null, failedAt: null })
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
      .mockReturnValueOnce({ id: "01-scaffold", status: "pending", checkpointTag: "", completionTag: null, isMerged: false, retries: 0, duration: null, completedAt: null, failedAt: null })

    try {
      await runBuild(config)
    } catch {
      // process.exit throws
    }

    expect(runPhase).toHaveBeenCalledTimes(1)
  })

  it("calls resetRetries and prints resume message when state exists", async () => {
    const phases = [
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/p/01-scaffold.md" },
    ]

    vi.mocked(scanPhases).mockReturnValue(phases)
    vi.mocked(loadState).mockReturnValue({
      buildName: "test",
      startedAt: "2024-01-01T00:00:00.000Z",
      phases: [{ id: "01-scaffold", status: "failed", checkpointTag: "", completionTag: null, isMerged: false, retries: 1, duration: null, completedAt: null, failedAt: "2024-01-01" }],
    })
    vi.mocked(runPhase).mockResolvedValue("passed")
    vi.mocked(getNextIncompletePhase)
      .mockReturnValueOnce({ id: "01-scaffold", status: "pending", checkpointTag: "", completionTag: null, isMerged: false, retries: 0, duration: null, completedAt: null, failedAt: null })
      .mockReturnValueOnce(null)

    await runBuild(config)

    expect(resetRetries).toHaveBeenCalled()
    expect(printInfo).toHaveBeenCalledWith(expect.stringContaining("Resuming build"))
  })

  it("breaks when budget is exceeded", async () => {
    const phases = [
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/p/01-scaffold.md" },
      { id: "02-api", index: 2, slug: "api", filename: "02-api.md", filepath: "/p/02-api.md" },
    ]

    vi.mocked(scanPhases).mockReturnValue(phases)
    vi.mocked(runPhase).mockResolvedValue("passed")
    vi.mocked(getNextIncompletePhase)
      .mockReturnValueOnce({ id: "01-scaffold", status: "pending", checkpointTag: "", completionTag: null, isMerged: false, retries: 0, duration: null, completedAt: null, failedAt: null })
      .mockReturnValueOnce({ id: "02-api", status: "pending", checkpointTag: "", completionTag: null, isMerged: false, retries: 0, duration: null, completedAt: null, failedAt: null })
      .mockReturnValueOnce(null)

    // After first phase, budget exceeds limit
    vi.mocked(loadBudget).mockReturnValue({ entries: [], totalCostUsd: 15.00 })

    config.maxBudgetUsd = 10.00
    await runBuild(config)

    // Only ran first phase because budget exceeded after it
    expect(runPhase).toHaveBeenCalledTimes(1)
    expect(printInfo).toHaveBeenCalledWith(expect.stringContaining("Budget limit reached"))
  })

  it("skips sandbox detection when unsafe is true", async () => {
    const phases = [
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/p/01-scaffold.md" },
    ]

    vi.mocked(scanPhases).mockReturnValue(phases)
    vi.mocked(runPhase).mockResolvedValue("passed")
    vi.mocked(getNextIncompletePhase)
      .mockReturnValueOnce({ id: "01-scaffold", status: "pending", checkpointTag: "", completionTag: null, isMerged: false, retries: 0, duration: null, completedAt: null, failedAt: null })
      .mockReturnValueOnce(null)
    vi.mocked(loadBudget).mockReturnValue({ entries: [], totalCostUsd: 0 })

    config.unsafe = true
    try { await runBuild(config) } catch { /* process.exit mock throws */ }

    expect(detectSandbox).not.toHaveBeenCalled()
  })

  it("retries merge without re-running phase when phase is complete but unmerged", async () => {
    const phases = [
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/p/01-scaffold.md" },
    ]

    vi.mocked(scanPhases).mockReturnValue(phases)
    vi.mocked(loadState).mockReturnValue({
      buildName: "test",
      startedAt: "2024-01-01T00:00:00.000Z",
      phases: [{
        id: "01-scaffold", status: "complete", checkpointTag: "", completionTag: "ridgeline/phase/test/01-scaffold",
        isMerged: false, retries: 0, duration: 100, completedAt: "2024-01-01", failedAt: null,
      }],
    })

    // No incomplete phases — all are "complete"
    vi.mocked(getNextIncompletePhase).mockReturnValue(null)
    // But one is unmerged
    vi.mocked(getNextUnmergedPhase)
      .mockReturnValueOnce({
        id: "01-scaffold", status: "complete", checkpointTag: "", completionTag: "ridgeline/phase/test/01-scaffold",
        isMerged: false, retries: 0, duration: 100, completedAt: "2024-01-01", failedAt: null,
      })
      .mockReturnValueOnce(null)

    await runBuild(config)

    // Phase should NOT be re-run
    expect(runPhase).not.toHaveBeenCalled()
    // But reflectCommits should be called to retry the merge
    expect(reflectCommits).toHaveBeenCalled()
  })

  it("does not clean up when all phases complete but not all merged", async () => {
    const phases = [
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/p/01-scaffold.md" },
    ]

    vi.mocked(scanPhases).mockReturnValue(phases)
    vi.mocked(loadState).mockReturnValue({
      buildName: "test",
      startedAt: "2024-01-01T00:00:00.000Z",
      phases: [{
        id: "01-scaffold", status: "complete", checkpointTag: "", completionTag: "ridgeline/phase/test/01-scaffold",
        isMerged: false, retries: 0, duration: 100, completedAt: "2024-01-01", failedAt: null,
      }],
    })

    vi.mocked(getNextIncompletePhase).mockReturnValue(null)
    vi.mocked(getNextUnmergedPhase)
      .mockReturnValueOnce({
        id: "01-scaffold", status: "complete", checkpointTag: "", completionTag: "ridgeline/phase/test/01-scaffold",
        isMerged: false, retries: 0, duration: 100, completedAt: "2024-01-01", failedAt: null,
      })
    vi.mocked(reflectCommits).mockImplementation(() => { throw new Error("conflict") })

    try { await runBuild(config) } catch { /* process.exit */ }

    expect(removeWorktree).not.toHaveBeenCalled()
    expect(cleanupBuildTags).not.toHaveBeenCalled()
  })

  it("resumes existing valid worktree instead of creating new one", async () => {
    const phases = [
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/p/01-scaffold.md" },
    ]

    vi.mocked(scanPhases).mockReturnValue(phases)
    vi.mocked(runPhase).mockResolvedValue("passed")
    vi.mocked(validateWorktree).mockReturnValue(true)
    vi.mocked(getNextIncompletePhase)
      .mockReturnValueOnce({ id: "01-scaffold", status: "pending", checkpointTag: "", completionTag: null, isMerged: false, retries: 0, duration: null, completedAt: null, failedAt: null })
      .mockReturnValueOnce(null)
    vi.mocked(loadBudget).mockReturnValue({ entries: [], totalCostUsd: 0 })

    try { await runBuild(config) } catch { /* process.exit mock throws */ }

    expect(printInfo).toHaveBeenCalledWith(expect.stringContaining("Resuming in worktree"))
  })
})
