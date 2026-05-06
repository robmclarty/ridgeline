export type EventName = "state" | "budget" | "trajectory"

export interface DashboardEvent {
  id: number
  name: EventName
  data: string
}

interface EventBuffer {
  push(name: EventName, payload: unknown): DashboardEvent
  replayAfter(id: number): DashboardEvent[]
}

export const createEventBuffer = (perTypeCap: number = 200): EventBuffer => {
  let events: DashboardEvent[] = []
  let lastId = 0

  const prune = (): void => {
    const byName: Record<EventName, DashboardEvent[]> = { state: [], budget: [], trajectory: [] }
    for (const ev of events) byName[ev.name].push(ev)
    const keep = new Set<number>()
    for (const name of ["state", "budget", "trajectory"] as const) {
      const arr = byName[name]
      const slice = arr.slice(-perTypeCap)
      for (const ev of slice) keep.add(ev.id)
    }
    events = events.filter((ev) => keep.has(ev.id))
  }

  const push = (name: EventName, payload: unknown): DashboardEvent => {
    lastId += 1
    const event: DashboardEvent = {
      id: lastId,
      name,
      data: JSON.stringify(payload),
    }
    events.push(event)
    prune()
    return event
  }

  const replayAfter = (id: number): DashboardEvent[] =>
    events.filter((ev) => ev.id > id)

  return { push, replayAfter }
}
