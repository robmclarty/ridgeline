// upstream-RFC candidate; ridgeline-side until production exposure proves the abstraction.
import { compose, step, aborted_error, type Step, type RunContext } from "fascicle"

export type GraphDrainConfig<i, o> = {
  readonly name?: string
  readonly do: Step<i, o>
  readonly concurrency: number
}

const throwIfAborted = (ctx: RunContext): void => {
  if (!ctx.abort.aborted) return
  const reason = ctx.abort.reason
  throw reason instanceof Error ? reason : new aborted_error("aborted", { reason })
}

export const graph_drain = <i, o>(
  config: GraphDrainConfig<i, o>,
): Step<ReadonlyArray<i>, ReadonlyArray<o>> => {
  const concurrency = Math.max(1, Math.floor(config.concurrency))
  const inner = step<ReadonlyArray<i>, ReadonlyArray<o>>(
    "graph_drain_inner",
    async (inputs, ctx) => {
      const results: o[] = new Array<o>(inputs.length)
      let cursor = 0
      ctx.emit({ graph_drain_event: "drain_start", total: inputs.length, concurrency })
      const worker = async (): Promise<void> => {
        while (cursor < inputs.length) {
          throwIfAborted(ctx)
          const idx = cursor
          cursor += 1
          if (idx >= inputs.length) return
          results[idx] = await config.do.run(inputs[idx], ctx)
        }
      }
      const workerCount = Math.min(concurrency, inputs.length)
      const workers: Promise<void>[] = []
      for (let i = 0; i < workerCount; i += 1) workers.push(worker())
      await Promise.all(workers)
      ctx.emit({ graph_drain_event: "drain_complete", total: inputs.length })
      return results
    },
  )
  return compose(config.name ?? "graph_drain", inner)
}
