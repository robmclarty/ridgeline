import { describe, expect, it } from "vitest"
import { buildSnapshot } from "../snapshot.js"
import type { BudgetState, BuildState, TrajectoryEntry } from "../../../types.js"

const baseState = (overrides: Partial<BuildState> = {}): BuildState => ({
  buildName: "demo",
  startedAt: "2026-04-22T12:00:00.000Z",
  pipeline: {
    shape: "complete",
    design: "skipped",
    spec: "complete",
    research: "skipped",
    refine: "skipped",
    plan: "complete",
    build: "running",
  },
  phases: [
    {
      id: "01-scaffold",
      status: "complete",
      checkpointTag: "rl/demo/01-scaffold/c",
      completionTag: "rl/demo/01-scaffold/done",
      retries: 0,
      duration: 10_000,
      completedAt: "2026-04-22T12:00:10.000Z",
      failedAt: null,
    },
  ],
  ...overrides,
})

describe("buildSnapshot", () => {
  it("returns idle when there is no state", () => {
    const snap = buildSnapshot(null, null, { entries: [], totalCostUsd: 0 }, [])
    expect(snap.status).toBe("idle")
    expect(snap.phases).toEqual([])
  })

  it("reports running when pipeline.build === running", () => {
    const snap = buildSnapshot("demo", baseState(), { entries: [], totalCostUsd: 0 }, [])
    expect(snap.status).toBe("running")
  })

  it("reports failed if any phase is failed", () => {
    const snap = buildSnapshot("demo", baseState({
      phases: [{
        id: "01-x",
        status: "failed",
        checkpointTag: "t",
        completionTag: null,
        retries: 1,
        duration: null,
        completedAt: null,
        failedAt: "2026-04-22T12:05:00.000Z",
      }],
    }), { entries: [], totalCostUsd: 0 }, [])
    expect(snap.status).toBe("failed")
  })

  it("summarizes budget per role with known ordering", () => {
    const budget: BudgetState = {
      totalCostUsd: 3,
      entries: [
        { phase: "01", role: "builder", attempt: 1, costUsd: 1, inputTokens: 0, outputTokens: 0, durationMs: 0, timestamp: "t" },
        { phase: "01", role: "reviewer", attempt: 1, costUsd: 0.5, inputTokens: 0, outputTokens: 0, durationMs: 0, timestamp: "t" },
        { phase: "01", role: "planner", attempt: 1, costUsd: 1.5, inputTokens: 0, outputTokens: 0, durationMs: 0, timestamp: "t" },
      ],
    }
    const snap = buildSnapshot("demo", baseState(), budget, [])
    expect(snap.budget.totalCostUsd).toBe(3)
    expect(snap.budget.perRole.map((r) => r.role)).toEqual(["planner", "builder", "reviewer"])
  })

  it("returns the latest phase_fail / budget_exceeded as lastError", () => {
    const trajectory: TrajectoryEntry[] = [
      { timestamp: "t1", type: "build_start", phaseId: "01", duration: null, tokens: null, costUsd: null, summary: "start" },
      { timestamp: "t2", type: "phase_fail", phaseId: "01", duration: null, tokens: null, costUsd: null, summary: "check failed" },
    ]
    const snap = buildSnapshot("demo", baseState(), { entries: [], totalCostUsd: 0 }, trajectory)
    expect(snap.lastError).toEqual({ phaseId: "01", message: "check failed" })
  })

  it("tolerates unknown trajectory event types (returns null lastError)", () => {
    const trajectory = [{ timestamp: "t", type: "unknown_future_type", phaseId: null, duration: null, tokens: null, costUsd: null, summary: "x" }] as unknown as TrajectoryEntry[]
    const snap = buildSnapshot("demo", baseState(), { entries: [], totalCostUsd: 0 }, trajectory)
    expect(snap.lastError).toBeNull()
  })
})
