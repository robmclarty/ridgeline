// upstream-RFC candidate; ridgeline-side until production exposure proves the abstraction.
// Race semantics: cumulative budget can be exceeded by at most one in-flight step.
import { compose, step, aborted_error, type Step, type RunContext } from "fascicle"

export type CostCappedConfig<i, o> = {
  readonly name?: string
  readonly do: Step<i, o>
  readonly max_usd: number
  readonly subscribe: (callback: (cost_usd: number) => void) => () => void
}

export const cost_capped = <i, o>(
  config: CostCappedConfig<i, o>,
): Step<i, o> => {
  const inner = step<i, o>(
    "cost_capped_inner",
    async (input, ctx) => {
      const local = new AbortController()
      const composed = AbortSignal.any([ctx.abort, local.signal])
      const childCtx: RunContext = { ...ctx, abort: composed }

      let cumulative = 0
      let cap_breached = false
      const unsubscribe = config.subscribe((cost_usd) => {
        cumulative += cost_usd
        ctx.emit({ cost_capped_event: "cost_observed", cumulative_usd: cumulative })
        if (cumulative >= config.max_usd && !cap_breached) {
          cap_breached = true
          ctx.emit({
            cost_capped_event: "cost_cap_breached",
            cumulative_usd: cumulative,
            max_usd: config.max_usd,
          })
          local.abort(new aborted_error(`cost cap exceeded: ${cumulative} >= ${config.max_usd}`))
        }
      })

      ctx.on_cleanup(() => {
        unsubscribe()
      })

      try {
        return await config.do.run(input, childCtx)
      } catch (err) {
        if (cap_breached) {
          throw new aborted_error(
            `cost cap exceeded: ${cumulative} >= ${config.max_usd}`,
            { reason: { cumulative_usd: cumulative, max_usd: config.max_usd } },
          )
        }
        throw err
      } finally {
        unsubscribe()
      }
    },
  )
  return compose(config.name ?? "cost_capped", inner)
}
