import { compose, step, aborted_error, type Step, type RunContext } from "fascicle"

export type WorktreeItem<i> = {
  readonly index: number
  readonly input: i
}

export type WorktreeDriver<i, o> = {
  readonly create: (item: WorktreeItem<i>) => Promise<unknown> | unknown
  readonly merge: (item: WorktreeItem<i>, output: o) => Promise<void> | void
  readonly remove: (item: WorktreeItem<i>) => Promise<void> | void
}

export type MergeBack = "index_order" | "completion_order"

export type WorktreeIsolatedConfig<i, o> = {
  readonly name?: string
  readonly do: Step<WorktreeItem<i>, o>
  readonly driver: WorktreeDriver<i, o>
  readonly merge_back?: MergeBack
  readonly concurrency?: number
}

const throwIfAborted = (ctx: RunContext): void => {
  if (!ctx.abort.aborted) return
  const reason = ctx.abort.reason
  throw reason instanceof Error ? reason : new aborted_error("aborted", { reason })
}

export const worktree_isolated = <i, o>(
  config: WorktreeIsolatedConfig<i, o>,
): Step<ReadonlyArray<WorktreeItem<i>>, ReadonlyArray<o>> => {
  const mergeBack: MergeBack = config.merge_back ?? "index_order"
  const concurrency = Math.max(1, Math.floor(config.concurrency ?? Number.MAX_SAFE_INTEGER))

  const inner = step<ReadonlyArray<WorktreeItem<i>>, ReadonlyArray<o>>(
    "worktree_isolated_inner",
    async (items, ctx) => {
      const created = new Set<number>()
      ctx.on_cleanup(async () => {
        for (const idx of [...created].sort((a, b) => a - b)) {
          const item = items.find((it) => it.index === idx)
          if (!item) continue
          try {
            await config.driver.remove(item)
          } catch {
            // cleanup is best-effort
          }
        }
      })

      type Completed = { readonly item: WorktreeItem<i>; readonly output: o; readonly completionRank: number }
      const completed: Completed[] = []
      let completionCounter = 0
      let cursor = 0

      ctx.emit({ worktree_event: "worktree_start", total: items.length, merge_back: mergeBack })

      const worker = async (): Promise<void> => {
        while (cursor < items.length) {
          throwIfAborted(ctx)
          const idx = cursor
          cursor += 1
          if (idx >= items.length) return
          const item = items[idx]
          await config.driver.create(item)
          created.add(item.index)
          const output = await config.do.run(item, ctx)
          const rank = completionCounter
          completionCounter += 1
          completed.push({ item, output, completionRank: rank })
        }
      }

      const workerCount = Math.min(concurrency, items.length)
      const workers: Promise<void>[] = []
      for (let i = 0; i < workerCount; i += 1) workers.push(worker())
      await Promise.all(workers)

      const sorted = [...completed].sort((a, b) =>
        mergeBack === "index_order"
          ? a.item.index - b.item.index
          : a.completionRank - b.completionRank,
      )

      const outputs: o[] = []
      for (const c of sorted) {
        throwIfAborted(ctx)
        await config.driver.merge(c.item, c.output)
        outputs.push(c.output)
      }
      ctx.emit({ worktree_event: "worktree_complete", merged: outputs.length })
      return outputs
    },
  )
  return compose(config.name ?? "worktree_isolated", inner)
}
