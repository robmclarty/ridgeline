import { describe, it, expect } from "vitest"
import { run, step, aborted_error, type Step, type TrajectoryLogger } from "fascicle"
import { cost_capped } from "../cost_capped.js"
import { recordingTrajectory, sleep } from "./_helpers.js"

type CostBus = {
  emit: (cost_usd: number) => void
  subscribe: (cb: (cost_usd: number) => void) => () => void
}

const makeCostBus = (): CostBus => {
  const subs = new Set<(cost_usd: number) => void>()
  return {
    emit: (cost_usd) => {
      for (const s of subs) s(cost_usd)
    },
    subscribe: (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
  }
}

describe("cost_capped composite", () => {
  it("emits a trajectory span named 'cost_capped'", async () => {
    const bus = makeCostBus()
    const inner: Step<number, number> = step("noop", (n) => n)
    const flow = cost_capped({ do: inner, max_usd: 1.0, subscribe: bus.subscribe })
    const { logger, events } = recordingTrajectory()
    await run(flow, 42, { trajectory: logger, install_signal_handlers: false })
    const spans = events.filter((e) => e.kind === "span_start" && e.name === "cost_capped")
    expect(spans.length).toBe(1)
  })

  it("aborts the inner step on cumulative 0.50 + 0.45 + 0.10 = 1.05 with max_usd 1.00 (race: at most one in-flight step exceeds)", async () => {
    const bus = makeCostBus()
    const seen: number[] = []
    const inner: Step<number, number> = step("model", async (n, ctx) => {
      seen.push(n)
      const start = Date.now()
      while (Date.now() - start < 1_000) {
        if (ctx.abort.aborted) {
          throw new aborted_error("aborted by cost cap")
        }
        await sleep(5)
      }
      return n
    })
    const flow = cost_capped({ do: inner, max_usd: 1.0, subscribe: bus.subscribe })
    const { logger } = recordingTrajectory()
    let caught: unknown
    const promise = run(flow, 1, { trajectory: logger, install_signal_handlers: false })
    await sleep(20)
    bus.emit(0.5)
    await sleep(5)
    bus.emit(0.45)
    await sleep(5)
    bus.emit(0.1)
    try {
      await promise
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).name).toBe("aborted_error")
    expect(seen).toEqual([1])
  })

  it("propagates outer abort to the inner step within 100ms", async () => {
    const bus = makeCostBus()
    let aborted = false
    const inner: Step<number, number> = step("blocking", async (_n, ctx) => {
      const start = Date.now()
      while (Date.now() - start < 1_000) {
        if (ctx.abort.aborted) {
          aborted = true
          throw new aborted_error("aborted")
        }
        await sleep(5)
      }
      return 0
    })
    const flow = cost_capped({ do: inner, max_usd: 1.0, subscribe: bus.subscribe })
    const { logger } = recordingTrajectory()
    const ac = new AbortController()
    setTimeout(() => ac.abort(new aborted_error("test")), 30)
    const start = Date.now()
    let raised = false
    try {
      await flow.run(1, synthCtx(ac.signal, logger))
    } catch {
      raised = true
    }
    expect(raised).toBe(true)
    expect(aborted).toBe(true)
    expect(Date.now() - start).toBeLessThan(150)
  })

  it("registers cleanup that fires on success and on failure", async () => {
    let cleanupCount = 0
    const bus = makeCostBus()
    const inner: Step<number, number> = step("with_cleanup", (n, ctx) => {
      ctx.on_cleanup(() => {
        cleanupCount += 1
      })
      return n
    })
    const { logger: l1 } = recordingTrajectory()
    await run(
      cost_capped({ do: inner, max_usd: 1.0, subscribe: bus.subscribe }),
      5,
      { trajectory: l1, install_signal_handlers: false },
    )
    expect(cleanupCount).toBeGreaterThanOrEqual(1)

    cleanupCount = 0
    const failing: Step<number, number> = step("fail", (_n, ctx) => {
      ctx.on_cleanup(() => {
        cleanupCount += 1
      })
      throw new Error("inner")
    })
    const { logger: l2 } = recordingTrajectory()
    let failed = false
    try {
      await run(
        cost_capped({ do: failing, max_usd: 1.0, subscribe: bus.subscribe }),
        5,
        { trajectory: l2, install_signal_handlers: false },
      )
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
    expect(cleanupCount).toBeGreaterThanOrEqual(1)
  })

  it("emits cost_cap_breached event when the cumulative threshold is crossed", async () => {
    const bus = makeCostBus()
    const inner: Step<number, number> = step("model", async (n, ctx) => {
      const start = Date.now()
      while (Date.now() - start < 1_000) {
        if (ctx.abort.aborted) throw new aborted_error("aborted")
        await sleep(5)
      }
      return n
    })
    const { logger, events } = recordingTrajectory()
    const flow = cost_capped({ do: inner, max_usd: 1.0, subscribe: bus.subscribe })
    const promise = run(flow, 1, { trajectory: logger, install_signal_handlers: false })
    await sleep(20)
    bus.emit(0.5)
    bus.emit(0.45)
    bus.emit(0.1)
    try {
      await promise
    } catch {
      // expected
    }
    const breached = events.filter(
      (e) => (e as Record<string, unknown>)["cost_capped_event"] === "cost_cap_breached",
    )
    expect(breached.length).toBeGreaterThanOrEqual(1)
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
