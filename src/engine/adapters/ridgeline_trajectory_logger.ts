// Translates fascicle TrajectoryEvent → ridgeline on-disk event shape (decision: translate, not verbatim — preserves fascicle-viewer and external .jsonl consumer back-compat).
import type { TrajectoryEvent, TrajectoryLogger } from "fascicle"
import type { TrajectoryEntry } from "../../types"
import { appendTrajectoryEntry } from "../../stores/trajectory"

export const RIDGELINE_TRAJECTORY_KIND = "ridgeline_trajectory" as const

export type RidgelineTrajectoryEvent = {
  readonly kind: typeof RIDGELINE_TRAJECTORY_KIND
  readonly entry: TrajectoryEntry
}

export const isRidgelineTrajectoryEvent = (
  event: TrajectoryEvent,
): event is TrajectoryEvent & RidgelineTrajectoryEvent => {
  if (event.kind !== RIDGELINE_TRAJECTORY_KIND) return false
  const candidate = (event as { entry?: unknown }).entry
  return typeof candidate === "object" && candidate !== null
}

export const emitTrajectoryEntry = (
  trajectory: TrajectoryLogger,
  entry: TrajectoryEntry,
): void => {
  trajectory.record({ kind: RIDGELINE_TRAJECTORY_KIND, entry })
}

export type RidgelineTrajectoryLoggerOptions = {
  readonly buildDir: string
}

export const createRidgelineTrajectoryLogger = (
  options: RidgelineTrajectoryLoggerOptions,
): TrajectoryLogger => {
  let spanCounter = 0
  return {
    record: (event) => {
      if (isRidgelineTrajectoryEvent(event)) {
        appendTrajectoryEntry(options.buildDir, event.entry)
      }
    },
    start_span: (name) => {
      spanCounter += 1
      return `${name}:${spanCounter}`
    },
    end_span: () => {
      // Ridgeline does not record span boundaries to disk — preserves byte equality
      // with the pre-migration trajectory.jsonl format.
    },
  }
}
