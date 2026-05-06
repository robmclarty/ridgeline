import { compose, step, aborted_error, type Step, type RunContext } from "fascicle"

export type DiffReviewConfig<input, build_output, review_output> = {
  readonly name?: string
  readonly build: Step<input, build_output>
  readonly commit: Step<build_output, build_output>
  readonly diff: Step<build_output, build_output>
  readonly review: Step<build_output, review_output>
}

const throwIfAborted = (ctx: RunContext): void => {
  if (!ctx.abort.aborted) return
  const reason = ctx.abort.reason
  throw reason instanceof Error ? reason : new aborted_error("aborted", { reason })
}

export const diff_review = <input, build_output, review_output>(
  config: DiffReviewConfig<input, build_output, review_output>,
): Step<input, review_output> => {
  const inner = step<input, review_output>(
    "diff_review_inner",
    async (input, ctx) => {
      ctx.emit({ diff_review_event: "build_start" })
      const built = await config.build.run(input, ctx)
      throwIfAborted(ctx)
      ctx.emit({ diff_review_event: "commit_start" })
      const committed = await config.commit.run(built, ctx)
      throwIfAborted(ctx)
      ctx.emit({ diff_review_event: "diff_start" })
      const diffed = await config.diff.run(committed, ctx)
      throwIfAborted(ctx)
      ctx.emit({ diff_review_event: "review_start" })
      const reviewed = await config.review.run(diffed, ctx)
      ctx.emit({ diff_review_event: "review_complete" })
      return reviewed
    },
  )
  return compose(config.name ?? "diff_review", inner)
}
