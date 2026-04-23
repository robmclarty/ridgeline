export type EventName = "state" | "budget" | "trajectory"

export interface DashboardEvent {
  id: number
  name: EventName
  data: string
}

export class EventBuffer {
  private events: DashboardEvent[] = []
  private lastId = 0
  private readonly perTypeCap: number

  constructor(perTypeCap: number = 200) {
    this.perTypeCap = perTypeCap
  }

  push(name: EventName, payload: unknown): DashboardEvent {
    this.lastId += 1
    const event: DashboardEvent = {
      id: this.lastId,
      name,
      data: JSON.stringify(payload),
    }
    this.events.push(event)
    this.prune()
    return event
  }

  private prune(): void {
    const byName: Record<EventName, DashboardEvent[]> = { state: [], budget: [], trajectory: [] }
    for (const ev of this.events) byName[ev.name].push(ev)
    const keep = new Set<number>()
    for (const name of ["state", "budget", "trajectory"] as const) {
      const arr = byName[name]
      const slice = arr.slice(-this.perTypeCap)
      for (const ev of slice) keep.add(ev.id)
    }
    this.events = this.events.filter((ev) => keep.has(ev.id))
  }

  replayAfter(id: number): DashboardEvent[] {
    return this.events.filter((ev) => ev.id > id)
  }
}
