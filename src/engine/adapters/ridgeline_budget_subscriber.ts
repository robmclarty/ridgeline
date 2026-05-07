// Listens for ridgeline_cost events on ctx.trajectory and tallies them into
// budget.json. Idempotent on duplicate event ids so a single logical cost is
// never double-counted across redundant emit paths or replays.
import type { TrajectoryEvent, TrajectoryLogger } from "fascicle"
import type { BudgetEntry } from "../../types"
import { appendBudgetEntry } from "../../stores/budget"

export const RIDGELINE_COST_KIND = "ridgeline_cost" as const

export type RidgelineCostEvent = {
  readonly kind: typeof RIDGELINE_COST_KIND
  readonly id: string
  readonly entry: BudgetEntry
}

export const isRidgelineCostEvent = (
  event: TrajectoryEvent,
): event is TrajectoryEvent & RidgelineCostEvent => {
  if (event.kind !== RIDGELINE_COST_KIND) return false
  const id = (event as { id?: unknown }).id
  const entry = (event as { entry?: unknown }).entry
  return typeof id === "string" && typeof entry === "object" && entry !== null
}

export const buildCostEventId = (
  phase: string,
  role: string,
  attempt: number,
  sessionId: string,
): string => `${phase}:${role}:${attempt}:${sessionId}`

export const emitCostEntry = (
  trajectory: TrajectoryLogger,
  id: string,
  entry: BudgetEntry,
): void => {
  trajectory.record({ kind: RIDGELINE_COST_KIND, id, entry })
}

export type RidgelineBudgetSubscriberOptions = {
  readonly buildDir: string
}

export const createRidgelineBudgetSubscriber = (
  options: RidgelineBudgetSubscriberOptions,
): TrajectoryLogger => {
  const seenIds = new Set<string>()
  return {
    record: (event) => {
      if (isRidgelineCostEvent(event)) {
        if (seenIds.has(event.id)) return
        seenIds.add(event.id)
        appendBudgetEntry(options.buildDir, event.entry)
      }
    },
    start_span: (name) => name,
    end_span: () => {
      // No-op: budget subscriber does not record span boundaries.
    },
  }
}
