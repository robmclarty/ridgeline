import { describe, it, expect } from "vitest"
import { run, step, aborted_error, type Step, type TrajectoryLogger } from "fascicle"
import { diff_review } from "../diff_review.js"
import { recordingTrajectory, sleep } from "./_helpers.js"

type Build = { readonly text: string }
type Review = { readonly summary: string }

const buildStep: Step<{ readonly seed: string }, Build> = step("build", (input) => ({
  text: `built:${input.seed}`,
}))
const commitStep: Step<Build, Build> = step("commit", (b) => ({ text: `${b.text}+commit` }))
const diffStep: Step<Build, Build> = step("diff", (b) => ({ text: `${b.text}+diff` }))
const reviewStep: Step<Build, Review> = step("review", (b) => ({ summary: `reviewed:${b.text}` }))

describe("diff_review composite", () => {
  it("emits a trajectory span named 'diff_review'", async () => {
    const flow = diff_review({
      build: buildStep,
      commit: commitStep,
      diff: diffStep,
      review: reviewStep,
    })
    const { logger, events } = recordingTrajectory()
    const out = await run(flow, { seed: "x" }, { trajectory: logger, install_signal_handlers: false })
    expect(out.summary).toBe("reviewed:built:x+commit+diff")
    const spans = events.filter((e) => e.kind === "span_start" && e.name === "diff_review")
    expect(spans.length).toBe(1)
  })

  it("preserves build → commit → diff → review trajectory event ordering", async () => {
    const flow = diff_review({
      build: buildStep,
      commit: commitStep,
      diff: diffStep,
      review: reviewStep,
    })
    const { logger, events } = recordingTrajectory()
    await run(flow, { seed: "x" }, { trajectory: logger, install_signal_handlers: false })

    const findIndex = (key: string): number =>
      events.findIndex((e) => (e as Record<string, unknown>)["diff_review_event"] === key)

    const buildIdx = findIndex("build_start")
    const commitIdx = findIndex("commit_start")
    const diffIdx = findIndex("diff_start")
    const reviewIdx = findIndex("review_start")
    const reviewCompleteIdx = findIndex("review_complete")

    expect(buildIdx).toBeGreaterThanOrEqual(0)
    expect(commitIdx).toBeGreaterThan(buildIdx)
    expect(diffIdx).toBeGreaterThan(commitIdx)
    expect(reviewIdx).toBeGreaterThan(diffIdx)
    expect(reviewCompleteIdx).toBeGreaterThan(reviewIdx)
  })

  it("propagates abort to the inner step within 100ms", async () => {
    let aborted = false
    const blocking: Step<{ readonly seed: string }, Build> = step("slow_build", async (_, ctx) => {
      const start = Date.now()
      while (Date.now() - start < 1_000) {
        if (ctx.abort.aborted) {
          aborted = true
          throw new aborted_error("aborted")
        }
        await sleep(5)
      }
      return { text: "never" }
    })
    const flow = diff_review({
      build: blocking,
      commit: commitStep,
      diff: diffStep,
      review: reviewStep,
    })
    const { logger } = recordingTrajectory()
    const ac = new AbortController()
    setTimeout(() => ac.abort(new aborted_error("test")), 30)
    let raised = false
    const start = Date.now()
    try {
      await flow.run({ seed: "x" }, synthCtx(ac.signal, logger))
    } catch {
      raised = true
    }
    expect(raised).toBe(true)
    expect(aborted).toBe(true)
    expect(Date.now() - start).toBeLessThan(150)
  })

  it("runs ctx.on_cleanup handlers on success and failure paths", async () => {
    let cleanupCount = 0
    const cleanupBuild: Step<{ readonly seed: string }, Build> = step(
      "cleanup_build",
      (input, ctx) => {
        ctx.on_cleanup(() => {
          cleanupCount += 1
        })
        return { text: `built:${input.seed}` }
      },
    )

    // success
    const { logger: l1 } = recordingTrajectory()
    await run(
      diff_review({ build: cleanupBuild, commit: commitStep, diff: diffStep, review: reviewStep }),
      { seed: "x" },
      { trajectory: l1, install_signal_handlers: false },
    )
    expect(cleanupCount).toBe(1)

    // failure
    cleanupCount = 0
    const failingReview: Step<Build, Review> = step("fail_review", () => {
      throw new Error("review boom")
    })
    const { logger: l2 } = recordingTrajectory()
    let failed = false
    try {
      await run(
        diff_review({
          build: cleanupBuild,
          commit: commitStep,
          diff: diffStep,
          review: failingReview,
        }),
        { seed: "x" },
        { trajectory: l2, install_signal_handlers: false },
      )
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
    expect(cleanupCount).toBe(1)
  })

  it("surfaces inner Error with stable .name and .message", async () => {
    const failingDiff: Step<Build, Build> = step("fail_diff", () => {
      throw new Error("diff boom")
    })
    const flow = diff_review({
      build: buildStep,
      commit: commitStep,
      diff: failingDiff,
      review: reviewStep,
    })
    const { logger } = recordingTrajectory()
    let caught: unknown
    try {
      await run(flow, { seed: "x" }, { trajectory: logger, install_signal_handlers: false })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).name).toBe("Error")
    expect((caught as Error).message).toBe("diff boom")
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
