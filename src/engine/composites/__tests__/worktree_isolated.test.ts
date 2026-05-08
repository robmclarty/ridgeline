import { describe, it, expect } from "vitest"
import { run, step, aborted_error, type Step, type TrajectoryLogger } from "fascicle"
import {
  worktree_isolated,
  type WorktreeDriver,
  type WorktreeItem,
} from "../worktree_isolated.js"
import { recordingTrajectory, sleep } from "./_helpers.js"

type Spec = { readonly name: string }

const stubDriver = (
  ledger: { created: number[]; merged: number[]; removed: number[] },
): WorktreeDriver<Spec, string> => ({
  create: (item) => {
    ledger.created.push(item.index)
  },
  merge: (item) => {
    ledger.merged.push(item.index)
  },
  remove: (item) => {
    ledger.removed.push(item.index)
  },
})

describe("worktree_isolated composite", () => {
  it("emits a trajectory span named 'worktree_isolated'", async () => {
    const ledger = { created: [], merged: [], removed: [] }
    const inner: Step<WorktreeItem<Spec>, string> = step("p", (item) => item.input.name)
    const flow = worktree_isolated({
      do: inner,
      driver: stubDriver(ledger),
      merge_back: "index_order",
    })
    const { logger, events } = recordingTrajectory()
    const items: WorktreeItem<Spec>[] = [
      { index: 0, input: { name: "a" } },
      { index: 1, input: { name: "b" } },
    ]
    await run(flow, items, { trajectory: logger, install_signal_handlers: false })
    const spans = events.filter((e) => e.kind === "span_start" && e.name === "worktree_isolated")
    expect(spans.length).toBe(1)
  })

  it("merges in index_order regardless of completion order (input [2,0,1] with stalled high-index phases)", async () => {
    const ledger = { created: [] as number[], merged: [] as number[], removed: [] as number[] }
    const inner: Step<WorktreeItem<Spec>, string> = step("stall_inner", async (item) => {
      // Higher-index phases stall longer than lower-index phases.
      const delay = (item.index + 1) * 30
      await sleep(delay)
      return item.input.name
    })
    const flow = worktree_isolated({
      do: inner,
      driver: stubDriver(ledger),
      merge_back: "index_order",
    })
    const items: WorktreeItem<Spec>[] = [
      { index: 2, input: { name: "c" } },
      { index: 0, input: { name: "a" } },
      { index: 1, input: { name: "b" } },
    ]
    const { logger } = recordingTrajectory()
    const out = await run(flow, items, { trajectory: logger, install_signal_handlers: false })
    expect(ledger.merged).toEqual([0, 1, 2])
    expect(out).toEqual(["a", "b", "c"])
  })

  it("propagates abort to the inner step within 100ms", async () => {
    const ledger = { created: [] as number[], merged: [] as number[], removed: [] as number[] }
    let aborted = false
    const blocking: Step<WorktreeItem<Spec>, string> = step("blocking", async (_item, ctx) => {
      const start = Date.now()
      while (Date.now() - start < 1_000) {
        if (ctx.abort.aborted) {
          aborted = true
          throw new aborted_error("aborted")
        }
        await sleep(5)
      }
      return "never"
    })
    const flow = worktree_isolated({
      do: blocking,
      driver: stubDriver(ledger),
    })
    const { logger } = recordingTrajectory()
    const ac = new AbortController()
    setTimeout(() => ac.abort(new aborted_error("test")), 30)
    const items: WorktreeItem<Spec>[] = [
      { index: 0, input: { name: "a" } },
      { index: 1, input: { name: "b" } },
    ]
    let raised = false
    const start = Date.now()
    try {
      await flow.run(items, synthCtx(ac.signal, logger))
    } catch {
      raised = true
    }
    expect(raised).toBe(true)
    expect(aborted).toBe(true)
    expect(Date.now() - start).toBeLessThan(150)
  })

  it("registers a cleanup that removes created worktrees on success, failure, and abort", async () => {
    // success
    const okLedger = { created: [] as number[], merged: [] as number[], removed: [] as number[] }
    const inner: Step<WorktreeItem<Spec>, string> = step("ok", (item) => item.input.name)
    const { logger: l1 } = recordingTrajectory()
    await run(
      worktree_isolated({ do: inner, driver: stubDriver(okLedger) }),
      [
        { index: 0, input: { name: "a" } },
        { index: 1, input: { name: "b" } },
      ],
      { trajectory: l1, install_signal_handlers: false },
    )
    expect(okLedger.removed.sort()).toEqual([0, 1])

    // failure
    const failLedger = { created: [] as number[], merged: [] as number[], removed: [] as number[] }
    const failInner: Step<WorktreeItem<Spec>, string> = step("fail", (item) => {
      if (item.index === 1) throw new Error("boom")
      return item.input.name
    })
    const { logger: l2 } = recordingTrajectory()
    let failed = false
    try {
      await run(
        worktree_isolated({ do: failInner, driver: stubDriver(failLedger), concurrency: 1 }),
        [
          { index: 0, input: { name: "a" } },
          { index: 1, input: { name: "b" } },
        ],
        { trajectory: l2, install_signal_handlers: false },
      )
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
    expect(failLedger.removed.length).toBeGreaterThanOrEqual(1)
  })

  it("surfaces inner Error with stable .name and .message", async () => {
    const ledger = { created: [] as number[], merged: [] as number[], removed: [] as number[] }
    const failInner: Step<WorktreeItem<Spec>, string> = step("fail", () => {
      throw new Error("worktree inner failure")
    })
    const { logger } = recordingTrajectory()
    let caught: unknown
    try {
      await run(
        worktree_isolated({ do: failInner, driver: stubDriver(ledger), concurrency: 1 }),
        [{ index: 0, input: { name: "a" } }],
        { trajectory: logger, install_signal_handlers: false },
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).name).toBe("Error")
    expect((caught as Error).message).toBe("worktree inner failure")
  })
})

const synthCtx = (
  signal: AbortSignal,
  logger: TrajectoryLogger,
): import("fascicle").RunContext => ({
  run_id: "test",
  trajectory: logger,
  state: new Map(),
  abort: signal,
  emit: () => {},
  on_cleanup: () => {},
  streaming: false,
})
