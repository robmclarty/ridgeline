import { describe, it, expect, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../../test/setup.js"
import { BudgetEntry, BudgetState, ClaudeResult, TrajectoryEntry } from "../../../types.js"
import {
  appendBudgetEntry,
  loadBudget,
  makeBudgetEntry,
  recordCost,
} from "../../../stores/budget.js"
import {
  appendTrajectoryEntry,
  logTrajectory,
  makeTrajectoryEntry,
  readTrajectory,
} from "../../../stores/trajectory.js"
import {
  createRidgelineBudgetSubscriber,
  emitCostEntry,
  RIDGELINE_COST_KIND,
} from "../ridgeline_budget_subscriber.js"
import {
  createRidgelineTrajectoryLogger,
  emitTrajectoryEntry,
  RIDGELINE_TRAJECTORY_KIND,
} from "../ridgeline_trajectory_logger.js"

const fakeResult = (cost: number): ClaudeResult => ({
  success: true,
  result: "ok",
  durationMs: 100,
  costUsd: cost,
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  },
  sessionId: "session-x",
})

describe("store wrapping (cost/event flow goes through ctx.trajectory)", () => {
  let dir: string

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  describe("trajectory: legacy and adapter paths produce identical disk shape", () => {
    it("appendTrajectoryEntry and the adapter write the same JSON line for the same entry", () => {
      dir = makeTempDir()
      const directDir = path.join(dir, "direct")
      const adapterDir = path.join(dir, "adapter")
      fs.mkdirSync(directDir, { recursive: true })
      fs.mkdirSync(adapterDir, { recursive: true })

      const entry: TrajectoryEntry = {
        timestamp: "2026-04-02T16:00:00.000Z",
        type: "build_start",
        phaseId: "01-phase",
        duration: null,
        tokens: null,
        costUsd: null,
        summary: "Build attempt 1",
      }
      appendTrajectoryEntry(directDir, entry)

      const logger = createRidgelineTrajectoryLogger({ buildDir: adapterDir })
      logger.record({ kind: RIDGELINE_TRAJECTORY_KIND, entry })

      expect(fs.readFileSync(path.join(adapterDir, "trajectory.jsonl"), "utf-8"))
        .toBe(fs.readFileSync(path.join(directDir, "trajectory.jsonl"), "utf-8"))
    })

    it("logTrajectory and emitTrajectoryEntry produce structurally identical output", () => {
      dir = makeTempDir()
      const legacyDir = path.join(dir, "legacy")
      const adapterDir = path.join(dir, "adapter")
      fs.mkdirSync(legacyDir, { recursive: true })
      fs.mkdirSync(adapterDir, { recursive: true })

      const logger = createRidgelineTrajectoryLogger({ buildDir: adapterDir })

      logTrajectory(legacyDir, "build_complete", "01-phase", "Done", { duration: 1000 })
      emitTrajectoryEntry(
        logger,
        makeTrajectoryEntry("build_complete", "01-phase", "Done", { duration: 1000 }),
      )

      const legacyEntries = readTrajectory(legacyDir)
      const adapterEntries = readTrajectory(adapterDir)
      expect(legacyEntries).toHaveLength(1)
      expect(adapterEntries).toHaveLength(1)
      const legacy = legacyEntries[0]
      const adapter = adapterEntries[0]
      expect({ ...legacy, timestamp: undefined }).toEqual({ ...adapter, timestamp: undefined })
    })
  })

  describe("budget: legacy and adapter paths produce identical budget.json", () => {
    it("appendBudgetEntry and the adapter compute the same totalCostUsd", () => {
      dir = makeTempDir()
      const directDir = path.join(dir, "direct")
      const adapterDir = path.join(dir, "adapter")
      fs.mkdirSync(directDir, { recursive: true })
      fs.mkdirSync(adapterDir, { recursive: true })

      const entry: BudgetEntry = {
        phase: "plan",
        role: "planner",
        attempt: 0,
        costUsd: 0.123,
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 1,
        timestamp: "2026-04-02T15:56:41.061Z",
      }
      appendBudgetEntry(directDir, entry)

      const subscriber = createRidgelineBudgetSubscriber({ buildDir: adapterDir })
      emitCostEntry(subscriber, "id-1", entry)

      expect(loadBudget(directDir)).toEqual(loadBudget(adapterDir))
    })

    it("recordCost via the legacy path matches makeBudgetEntry + emitCostEntry via the adapter", () => {
      dir = makeTempDir()
      const legacyDir = path.join(dir, "legacy")
      const adapterDir = path.join(dir, "adapter")
      fs.mkdirSync(legacyDir, { recursive: true })
      fs.mkdirSync(adapterDir, { recursive: true })

      const result = fakeResult(0.42)

      recordCost(legacyDir, "01-phase", "builder", 0, result)

      const subscriber = createRidgelineBudgetSubscriber({ buildDir: adapterDir })
      emitCostEntry(subscriber, "id-1", makeBudgetEntry("01-phase", "builder", 0, result))

      const legacy = loadBudget(legacyDir)
      const adapter = loadBudget(adapterDir)
      expect(adapter.entries).toHaveLength(1)
      expect(adapter.entries[0]).toMatchObject({
        phase: legacy.entries[0].phase,
        role: legacy.entries[0].role,
        attempt: legacy.entries[0].attempt,
        costUsd: legacy.entries[0].costUsd,
        inputTokens: legacy.entries[0].inputTokens,
        outputTokens: legacy.entries[0].outputTokens,
        durationMs: legacy.entries[0].durationMs,
      })
      expect(adapter.totalCostUsd).toBeCloseTo(legacy.totalCostUsd, 9)
    })
  })

  describe("two-tier resume invariant", () => {
    it("adapter checkpoint write and stores/state.ts write produce two files at distinct paths", async () => {
      dir = makeTempDir()
      const { saveState } = await import("../../../stores/state.js")
      const { createRidgelineCheckpointStore } = await import("../ridgeline_checkpoint_store.js")

      const checkpointStore = createRidgelineCheckpointStore({ buildDir: dir })
      await checkpointStore.set("01-phase", { ok: true })
      saveState(dir, {
        buildName: "test",
        startedAt: new Date().toISOString(),
        pipeline: {
          shape: "complete",
          design: "skipped",
          spec: "complete",
          research: "skipped",
          refine: "skipped",
          plan: "complete",
          build: "running",
        },
        phases: [],
      })

      const checkpointFile = path.join(dir, "state", "01-phase.json")
      const stateFile = path.join(dir, "state.json")
      expect(fs.existsSync(checkpointFile)).toBe(true)
      expect(fs.existsSync(stateFile)).toBe(true)
      expect(checkpointFile).not.toBe(stateFile)

      // The two paths must not overlap: checkpoint lives under state/, state.json lives at the build root.
      expect(path.dirname(checkpointFile)).toBe(path.join(dir, "state"))
      expect(path.dirname(stateFile)).toBe(dir)
    })
  })
})

describe("budget.json fixture replay reads back equal to baseline", () => {
  // Minimal smoke check that the adapter's accumulated state is byte-equal
  // to the recorded baseline — already covered in the subscriber tests but
  // included here so the wrapping suite stands on its own as the "via
  // ctx.trajectory" regression net for AC #7.
  let dir: string

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it("subscribed loads back to BudgetState identical to the baseline values", () => {
    dir = makeTempDir()
    const subscriber = createRidgelineBudgetSubscriber({ buildDir: dir })

    const entries: BudgetEntry[] = [
      {
        phase: "plan",
        role: "planner",
        attempt: 0,
        costUsd: 0.1230895,
        inputTokens: 4,
        outputTokens: 464,
        durationMs: 15239,
        timestamp: "2026-04-02T15:56:41.061Z",
      },
      {
        phase: "01-hello-script",
        role: "builder",
        attempt: 0,
        costUsd: 0.177659,
        inputTokens: 8,
        outputTokens: 832,
        durationMs: 27336,
        timestamp: "2026-04-02T15:57:10.215Z",
      },
      {
        phase: "01-hello-script",
        role: "reviewer",
        attempt: 0,
        costUsd: 0.1416815,
        inputTokens: 3,
        outputTokens: 958,
        durationMs: 17999,
        timestamp: "2026-04-02T15:57:29.859Z",
      },
    ]
    entries.forEach((entry, i) => emitCostEntry(subscriber, `id${i}`, entry))

    const budget: BudgetState = loadBudget(dir)
    expect(budget.totalCostUsd).toBe(0.44243)
    expect(budget.entries).toEqual(entries)
  })
})
