import type { TrajectoryEvent, TrajectoryLogger } from "fascicle"

export type RecordedTrajectory = {
  readonly logger: TrajectoryLogger
  readonly events: TrajectoryEvent[]
}

export const recordingTrajectory = (): RecordedTrajectory => {
  const events: TrajectoryEvent[] = []
  let counter = 0
  const logger: TrajectoryLogger = {
    record: (event) => {
      events.push(event)
    },
    start_span: (name, meta) => {
      counter += 1
      const span_id = `span_${counter}`
      events.push({ kind: "span_start", span_id, name, ...(meta ?? {}) })
      return span_id
    },
    end_span: (span_id, meta) => {
      events.push({ kind: "span_end", span_id, ...(meta ?? {}) })
    },
  }
  return { logger, events }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
