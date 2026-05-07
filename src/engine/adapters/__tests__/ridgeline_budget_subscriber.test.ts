import { describe, it, expect, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../../test/setup"
import { BudgetEntry, BudgetState } from "../../../types"
import {
  buildCostEventId,
  createRidgelineBudgetSubscriber,
  emitCostEntry,
  isRidgelineCostEvent,
  RIDGELINE_COST_KIND,
} from "../ridgeline_budget_subscriber"

const baselineBudgetPath = path.join(
  process.cwd(),
  ".ridgeline", "builds", "fascicle-migration", "baseline", "fixtures", "budget.json",
)

describe("ridgeline_budget_subscriber", () => {
  let dir: string

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it("appends a cost entry on a ridgeline_cost event", () => {
    dir = makeTempDir()
    const subscriber = createRidgelineBudgetSubscriber({ buildDir: dir })

    const entry: BudgetEntry = {
      phase: "plan",
      role: "planner",
      attempt: 0,
      costUsd: 0.123,
      inputTokens: 4,
      outputTokens: 464,
      durationMs: 15239,
      timestamp: "2026-04-02T15:56:41.061Z",
    }
    subscriber.record({ kind: RIDGELINE_COST_KIND, id: "plan:planner:0:s1", entry })

    const budget = JSON.parse(fs.readFileSync(path.join(dir, "budget.json"), "utf-8")) as BudgetState
    expect(budget.entries).toEqual([entry])
    expect(budget.totalCostUsd).toBeCloseTo(0.123, 9)
  })

  it("ignores non-ridgeline-cost events", () => {
    dir = makeTempDir()
    const subscriber = createRidgelineBudgetSubscriber({ buildDir: dir })

    subscriber.record({ kind: "ridgeline_trajectory", entry: {} })
    subscriber.record({ kind: "emit", payload: 1 })
    subscriber.record({ kind: "span_start", span_id: "x", name: "y" })
    subscriber.start_span("x")
    subscriber.end_span("x")

    expect(fs.existsSync(path.join(dir, "budget.json"))).toBe(false)
  })

  it("totalCostUsd matches the sum of received cost events within 1e-9", () => {
    dir = makeTempDir()
    const subscriber = createRidgelineBudgetSubscriber({ buildDir: dir })

    const costs = [0.1230895, 0.177659, 0.1416815]
    costs.forEach((cost, i) => {
      const entry: BudgetEntry = {
        phase: i === 0 ? "plan" : "01-hello-script",
        role: i === 0 ? "planner" : i === 1 ? "builder" : "reviewer",
        attempt: 0,
        costUsd: cost,
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 1,
        timestamp: "2026-04-02T15:56:41.061Z",
      }
      emitCostEntry(subscriber, `e${i}`, entry)
    })

    const budget = JSON.parse(fs.readFileSync(path.join(dir, "budget.json"), "utf-8")) as BudgetState
    const expected = costs.reduce((sum, c) => sum + c, 0)
    expect(Math.abs(budget.totalCostUsd - expected)).toBeLessThan(1e-9)
  })

  it("is idempotent on duplicated cost events with the same id", () => {
    dir = makeTempDir()
    const subscriber = createRidgelineBudgetSubscriber({ buildDir: dir })

    const entry: BudgetEntry = {
      phase: "plan",
      role: "planner",
      attempt: 0,
      costUsd: 0.5,
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      timestamp: "2026-04-02T15:56:41.061Z",
    }
    const id = "plan:planner:0:dup"
    subscriber.record({ kind: RIDGELINE_COST_KIND, id, entry })
    subscriber.record({ kind: RIDGELINE_COST_KIND, id, entry })
    subscriber.record({ kind: RIDGELINE_COST_KIND, id, entry })

    const budget = JSON.parse(fs.readFileSync(path.join(dir, "budget.json"), "utf-8")) as BudgetState
    expect(budget.entries).toHaveLength(1)
    expect(budget.totalCostUsd).toBeCloseTo(0.5, 9)
  })

  it("preserves byte equality across the baseline budget.json fixture", () => {
    dir = makeTempDir()
    const subscriber = createRidgelineBudgetSubscriber({ buildDir: dir })

    const baseline = fs.readFileSync(baselineBudgetPath, "utf-8")
    const baselineState = JSON.parse(baseline) as BudgetState
    baselineState.entries.forEach((entry, i) => {
      subscriber.record({ kind: RIDGELINE_COST_KIND, id: `b${i}`, entry })
    })

    const written = fs.readFileSync(path.join(dir, "budget.json"), "utf-8")
    expect(written).toBe(baseline)
  })

  it("buildCostEventId produces a stable id from inputs", () => {
    expect(buildCostEventId("plan", "planner", 0, "sess-x"))
      .toBe("plan:planner:0:sess-x")
    expect(buildCostEventId("plan", "planner", 0, "sess-x"))
      .toBe(buildCostEventId("plan", "planner", 0, "sess-x"))
  })

  describe("isRidgelineCostEvent", () => {
    it("returns true for valid ridgeline_cost events", () => {
      expect(
        isRidgelineCostEvent({
          kind: RIDGELINE_COST_KIND,
          id: "x",
          entry: { phase: "p" } as unknown as BudgetEntry,
        }),
      ).toBe(true)
    })

    it("returns false for events of other kinds", () => {
      expect(isRidgelineCostEvent({ kind: "emit" })).toBe(false)
      expect(isRidgelineCostEvent({ kind: "ridgeline_trajectory" })).toBe(false)
    })

    it("returns false when id or entry is missing", () => {
      expect(isRidgelineCostEvent({ kind: RIDGELINE_COST_KIND })).toBe(false)
      expect(isRidgelineCostEvent({ kind: RIDGELINE_COST_KIND, id: "x" })).toBe(false)
      expect(isRidgelineCostEvent({ kind: RIDGELINE_COST_KIND, entry: {} })).toBe(false)
      expect(isRidgelineCostEvent({ kind: RIDGELINE_COST_KIND, id: "x", entry: null })).toBe(false)
    })
  })
})
