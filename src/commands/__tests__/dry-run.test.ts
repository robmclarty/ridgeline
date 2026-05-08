import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup.js"
import type { RidgelineConfig } from "../../types.js"

vi.mock("../../ui/output.js", () => ({
  printInfo: vi.fn(),
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

vi.mock("../../stores/phases.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stores/phases.js")>()
  return {
    ...actual,
    scanPhases: vi.fn(() => []),
  }
})

vi.mock("../plan.js", () => ({
  runPlan: vi.fn(),
}))

import { runDryRun } from "../dry-run.js"
import { scanPhases } from "../../stores/phases.js"

describe("commands/dry-run", () => {
  let tmpDir: string
  let config: RidgelineConfig

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})
    tmpDir = makeTempDir()

    const phasesDir = path.join(tmpDir, "phases")
    fs.mkdirSync(phasesDir, { recursive: true })

    config = {
      buildName: "test",
      ridgelineDir: tmpDir,
      buildDir: tmpDir,
      constraintsPath: path.join(tmpDir, "constraints.md"),
      tastePath: null,
      handoffPath: path.join(tmpDir, "handoff.md"),
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
      requirePhaseApproval: false,
    }
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("displays phase information when phases exist", async () => {
    const phaseFile = path.join(config.phasesDir, "01-scaffold.md")
    fs.writeFileSync(phaseFile, "# Scaffold Project\n\n## Goal\nSet up the project structure.\n\n## Acceptance Criteria\n- Directory exists\n- Config files present\n")

    vi.mocked(scanPhases).mockReturnValue([
      { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: phaseFile, dependsOn: [] },
    ])

    await runDryRun(config)

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Scaffold Project"))
  })

  it("throws when no phases exist and planner generates none", async () => {
    // scanPhases returns empty both times (before and after plan)
    vi.mocked(scanPhases).mockReturnValue([])

    // Mock runPlan to be a no-op (it's mocked at module level)
    await expect(runDryRun(config)).rejects.toThrow("No phases generated")
  })
})
