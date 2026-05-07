import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { run, step, aborted_error, type Step } from "fascicle"
import { phase, type PhaseRoundResult } from "../phase"
import { recordingTrajectory, sleep } from "./_helpers"

type BuildOut = { readonly text: string }
type Verdict = { readonly summary: string }

const okBuild: Step<{ readonly seed: string }, BuildOut> = step(
  "ok_build",
  (input) => ({ text: `built:${input.seed}` }),
)

const passingReview = (verdict: Verdict): Step<BuildOut, PhaseRoundResult<Verdict>> =>
  step("pass_review", () => ({ passed: true, verdict }))

const rejectingReview = (verdict: Verdict): Step<BuildOut, PhaseRoundResult<Verdict>> =>
  step("reject_review", () => ({ passed: false, verdict }))

describe("phase composite", () => {
  it("emits a trajectory span named 'phase' on success", async () => {
    const { logger, events } = recordingTrajectory()
    const flow = phase({
      build: okBuild,
      review: passingReview({ summary: "ok" }),
      max_retries: 2,
    })
    const out = await run(flow, { seed: "x" }, { trajectory: logger, install_signal_handlers: false })
    expect(out.attempts).toBe(1)
    const phaseSpans = events.filter((e) => e.kind === "span_start" && e.name === "phase")
    expect(phaseSpans.length).toBeGreaterThanOrEqual(1)
  })

  it("propagates abort to the inner step within 100ms", async () => {
    let buildAborted = false
    const slowBuild: Step<{ readonly seed: string }, BuildOut> = step(
      "slow_build",
      async (_input, ctx) => {
        const start = Date.now()
        while (Date.now() - start < 1_000) {
          if (ctx.abort.aborted) {
            buildAborted = true
            throw new aborted_error("aborted in build")
          }
          await sleep(5)
        }
        return { text: "never" }
      },
    )
    const { logger } = recordingTrajectory()
    const flow = phase({
      build: slowBuild,
      review: passingReview({ summary: "ok" }),
      max_retries: 0,
    })

    const ac = new AbortController()
    setTimeout(() => ac.abort(new aborted_error("test abort")), 30)

    // Manually wire abort: fascicle's run() doesn't accept an external signal,
    // so we drive the step directly with a synthetic ctx.
    const start = Date.now()
    let elapsed = 0
    let raised = false
    try {
      await flow.run(
        { seed: "x" },
        {
          run_id: "test",
          trajectory: logger,
          state: new Map(),
          abort: ac.signal,
          emit: () => {},
          on_cleanup: () => {},
          streaming: false,
        },
      )
    } catch {
      raised = true
      elapsed = Date.now() - start
    }
    expect(raised).toBe(true)
    expect(buildAborted).toBe(true)
    expect(elapsed).toBeLessThan(150)
  })

  it("runs ctx.on_cleanup handlers on success, failure, and abort", async () => {
    const order: string[] = []
    const successBuild: Step<{ readonly seed: string }, BuildOut> = step(
      "cleanup_build",
      (_input, ctx) => {
        ctx.on_cleanup(() => {
          order.push("cleanup")
        })
        return { text: "ok" }
      },
    )

    // success path
    const { logger: l1 } = recordingTrajectory()
    await run(
      phase({ build: successBuild, review: passingReview({ summary: "ok" }), max_retries: 0 }),
      { seed: "a" },
      { trajectory: l1, install_signal_handlers: false },
    )
    expect(order).toContain("cleanup")

    // failure path: build throws
    order.length = 0
    const failBuild: Step<{ readonly seed: string }, BuildOut> = step(
      "fail_build",
      (_input, ctx) => {
        ctx.on_cleanup(() => {
          order.push("cleanup")
        })
        throw new Error("build_fail")
      },
    )
    const { logger: l2 } = recordingTrajectory()
    let failed = false
    try {
      await run(
        phase({ build: failBuild, review: passingReview({ summary: "ok" }), max_retries: 0 }),
        { seed: "a" },
        { trajectory: l2, install_signal_handlers: false },
      )
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
    expect(order).toContain("cleanup")

    // abort path: cleanup still runs
    order.length = 0
    const blockBuild: Step<{ readonly seed: string }, BuildOut> = step(
      "block_build",
      async (_input, ctx) => {
        ctx.on_cleanup(() => {
          order.push("cleanup")
        })
        const start = Date.now()
        while (Date.now() - start < 500) {
          if (ctx.abort.aborted) throw new aborted_error("aborted")
          await sleep(5)
        }
        return { text: "never" }
      },
    )
    const { logger: l3 } = recordingTrajectory()
    const ac = new AbortController()
    setTimeout(() => ac.abort(new aborted_error("test")), 30)
    let aborted = false
    try {
      await flowRunWithExternalSignal(
        phase({ build: blockBuild, review: passingReview({ summary: "ok" }), max_retries: 0 }),
        { seed: "a" },
        ac.signal,
        l3,
      )
    } catch {
      aborted = true
    }
    expect(aborted).toBe(true)
    expect(order).toContain("cleanup")
  })

  it("throws Error('Retries exhausted') after maxRetries+1 unsuccessful rounds matching the baseline fixture", async () => {
    const { logger } = recordingTrajectory()
    const flow = phase({
      build: okBuild,
      review: rejectingReview({ summary: "nope" }),
      max_retries: 2,
    })
    let caught: unknown
    try {
      await run(flow, { seed: "x" }, { trajectory: logger, install_signal_handlers: false })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    const err = caught as Error
    expect(err.name).toBe("Error")
    expect(err.message).toBe("Retries exhausted")

    const fixturePath = path.resolve(
      __dirname,
      "../../../../.ridgeline/builds/fascicle-migration/baseline/fixtures/error-shapes.json",
    )
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8"))
    expect(err.name).toBe(fixture.adversarial_round_cap_exhaustion.name)
    expect(err.message).toBe(fixture.adversarial_round_cap_exhaustion.trajectory_event.message)
  })

  it("invokes archive_feedback between rejected rounds", async () => {
    const archived: number[] = []
    const archiveStep: Step<{ verdict: Verdict; attempt: number }, void> = step(
      "archive",
      (input) => {
        archived.push(input.attempt)
      },
    )
    let attemptCount = 0
    const flakyReview: Step<BuildOut, PhaseRoundResult<Verdict>> = step(
      "flaky_review",
      () => {
        attemptCount += 1
        if (attemptCount < 3) {
          return { passed: false, verdict: { summary: `fail-${attemptCount}` } }
        }
        return { passed: true, verdict: { summary: "ok" } }
      },
    )
    const { logger } = recordingTrajectory()
    const out = await run(
      phase({
        build: okBuild,
        review: flakyReview,
        max_retries: 5,
        archive_feedback: archiveStep,
      }),
      { seed: "x" },
      { trajectory: logger, install_signal_handlers: false },
    )
    expect(out.attempts).toBe(3)
    expect(archived).toEqual([1, 2])
  })
})

const flowRunWithExternalSignal = async <i, o>(
  flow: Step<i, o>,
  input: i,
  signal: AbortSignal,
  logger: import("fascicle").TrajectoryLogger,
): Promise<o> => {
  const cleanupHandlers: Array<() => Promise<void> | void> = []
  try {
    return await flow.run(input, {
      run_id: "test",
      trajectory: logger,
      state: new Map(),
      abort: signal,
      emit: () => {},
      on_cleanup: (fn) => {
        cleanupHandlers.push(fn)
      },
      streaming: false,
    })
  } finally {
    for (let i = cleanupHandlers.length - 1; i >= 0; i -= 1) {
      try {
        await cleanupHandlers[i]()
      } catch {
        // best effort
      }
    }
  }
}
