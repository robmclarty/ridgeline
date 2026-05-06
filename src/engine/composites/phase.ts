// Uses an `archive_feedback` slot rather than composing `adversarial_archived` (taste.md: pick one).
import { compose, step, aborted_error, type Step, type RunContext } from "fascicle"

export type PhaseRoundResult<verdict> = {
  readonly passed: boolean
  readonly verdict: verdict
}

export type PhaseArchiveInput<verdict> = {
  readonly verdict: verdict
  readonly attempt: number
}

export type PhaseConfig<input, build_output, verdict> = {
  readonly name?: string
  readonly build: Step<input, build_output>
  readonly review: Step<build_output, PhaseRoundResult<verdict>>
  readonly max_retries: number
  readonly archive_feedback?: Step<PhaseArchiveInput<verdict>, void>
}

export type PhaseResult<verdict> = {
  readonly verdict: verdict
  readonly attempts: number
}

const throwIfAborted = (ctx: RunContext): void => {
  if (!ctx.abort.aborted) return
  const reason = ctx.abort.reason
  throw reason instanceof Error ? reason : new aborted_error("aborted", { reason })
}

export const phase = <input, build_output, verdict>(
  config: PhaseConfig<input, build_output, verdict>,
): Step<input, PhaseResult<verdict>> => {
  const maxAttempts = Math.max(1, Math.floor(config.max_retries) + 1)
  const inner = step<input, PhaseResult<verdict>>(
    "phase_inner",
    async (input, ctx) => {
      ctx.emit({ phase_event: "phase_start", max_retries: config.max_retries })
      let attempt = 0
      while (attempt < maxAttempts) {
        throwIfAborted(ctx)
        ctx.emit({ phase_event: "phase_attempt", attempt: attempt + 1 })
        const buildOut = await config.build.run(input, ctx)
        throwIfAborted(ctx)
        const reviewed = await config.review.run(buildOut, ctx)
        if (reviewed.passed) {
          ctx.emit({ phase_event: "phase_pass", attempt: attempt + 1 })
          return { verdict: reviewed.verdict, attempts: attempt + 1 }
        }
        ctx.emit({ phase_event: "phase_reject", attempt: attempt + 1 })
        if (config.archive_feedback) {
          await config.archive_feedback.run({ verdict: reviewed.verdict, attempt: attempt + 1 }, ctx)
        }
        attempt += 1
      }
      ctx.emit({ phase_event: "phase_fail", attempts: attempt })
      throw new Error("Retries exhausted")
    },
  )
  return compose(config.name ?? "phase", inner)
}
