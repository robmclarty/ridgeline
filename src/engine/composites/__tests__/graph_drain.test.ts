import { describe, it, expect } from "vitest"
import { run, step, aborted_error, type Step, type TrajectoryLogger } from "fascicle"
import { graph_drain } from "../graph_drain"
import { recordingTrajectory, sleep } from "./_helpers"

describe("graph_drain composite", () => {
  it("emits a trajectory span named 'graph_drain'", async () => {
    const { logger, events } = recordingTrajectory()
    const inner: Step<number, number> = step("double", (n) => n * 2)
    const flow = graph_drain({ do: inner, concurrency: 2 })
    const out = await run(flow, [1, 2, 3, 4], { trajectory: logger, install_signal_handlers: false })
    expect(out).toEqual([2, 4, 6, 8])
    const spans = events.filter((e) => e.kind === "span_start" && e.name === "graph_drain")
    expect(spans.length).toBe(1)
  })

  it("respects concurrency=2 across 4 ready steps that block on a shared signal", async () => {
    let inFlight = 0
    let observedMax = 0
    let resolveGate: () => void = () => {}
    const releaser: Promise<void> = new Promise((resolve) => {
      resolveGate = resolve
    })
    const block: Step<number, number> = step("block", async (n) => {
      inFlight += 1
      observedMax = Math.max(observedMax, inFlight)
      await releaser
      inFlight -= 1
      return n
    })
    const { logger } = recordingTrajectory()
    const flow = graph_drain({ do: block, concurrency: 2 })
    const result = run(flow, [1, 2, 3, 4], { trajectory: logger, install_signal_handlers: false })
    await sleep(50)
    expect(observedMax).toBe(2)
    resolveGate()
    const final = await result
    expect(final.length).toBe(4)
    expect(observedMax).toBe(2)
  })

  it("propagates abort to the inner step within 100ms", async () => {
    let abortObserved = false
    const blockingStep: Step<number, number> = step("blocking", async (_n, ctx) => {
      const start = Date.now()
      while (Date.now() - start < 1_000) {
        if (ctx.abort.aborted) {
          abortObserved = true
          throw new aborted_error("aborted")
        }
        await sleep(5)
      }
      return 0
    })
    const flow = graph_drain({ do: blockingStep, concurrency: 1 })
    const ac = new AbortController()
    setTimeout(() => ac.abort(new aborted_error("test")), 30)
    const start = Date.now()
    const { logger } = recordingTrajectory()
    let raised = false
    try {
      await flow.run([1, 2, 3], synthCtx(ac.signal, logger))
    } catch {
      raised = true
    }
    const elapsed = Date.now() - start
    expect(raised).toBe(true)
    expect(abortObserved).toBe(true)
    expect(elapsed).toBeLessThan(150)
  })

  it("registers a cleanup handler that runs on success and on failure", async () => {
    let cleanupCount = 0
    const innerWithCleanup: Step<number, number> = step("with_cleanup", (n, ctx) => {
      ctx.on_cleanup(() => {
        cleanupCount += 1
      })
      return n
    })

    const { logger: l1 } = recordingTrajectory()
    await run(
      graph_drain({ do: innerWithCleanup, concurrency: 2 }),
      [1, 2, 3],
      { trajectory: l1, install_signal_handlers: false },
    )
    expect(cleanupCount).toBe(3)

    cleanupCount = 0
    const failOnTwo: Step<number, number> = step("fail_on_two", (n, ctx) => {
      ctx.on_cleanup(() => {
        cleanupCount += 1
      })
      if (n === 2) throw new Error("boom")
      return n
    })
    const { logger: l2 } = recordingTrajectory()
    let failed = false
    try {
      await run(
        graph_drain({ do: failOnTwo, concurrency: 1 }),
        [1, 2, 3],
        { trajectory: l2, install_signal_handlers: false },
      )
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
    expect(cleanupCount).toBeGreaterThanOrEqual(1)
  })

  it("surfaces inner step errors with a stable .name", async () => {
    const failing: Step<number, number> = step("fail", () => {
      throw new Error("inner failure")
    })
    const { logger } = recordingTrajectory()
    let caught: unknown
    try {
      await run(
        graph_drain({ do: failing, concurrency: 1 }),
        [1],
        { trajectory: logger, install_signal_handlers: false },
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).name).toBe("Error")
    expect((caught as Error).message).toBe("inner failure")
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
