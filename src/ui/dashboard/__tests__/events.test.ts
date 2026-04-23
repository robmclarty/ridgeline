import { describe, expect, it } from "vitest"
import { EventBuffer } from "../events"

describe("EventBuffer", () => {
  it("assigns monotonic ids across event types", () => {
    const buf = new EventBuffer()
    const a = buf.push("state", { a: 1 })
    const b = buf.push("budget", { b: 2 })
    const c = buf.push("trajectory", { c: 3 })
    expect(a.id).toBe(1)
    expect(b.id).toBe(2)
    expect(c.id).toBe(3)
  })

  it("replayAfter returns only events with id greater than requested", () => {
    const buf = new EventBuffer()
    buf.push("state", { a: 1 })
    buf.push("budget", { b: 2 })
    const third = buf.push("trajectory", { c: 3 })
    const out = buf.replayAfter(1)
    expect(out.map((e) => e.id)).toEqual([2, 3])
    expect(out[1].id).toBe(third.id)
  })

  it("caps each event type at its per-type cap (>= 200 per spec)", () => {
    const buf = new EventBuffer(3)
    for (let i = 0; i < 5; i++) buf.push("state", i)
    for (let i = 0; i < 5; i++) buf.push("budget", i)
    for (let i = 0; i < 5; i++) buf.push("trajectory", i)
    const all = buf.replayAfter(0)
    const counts = { state: 0, budget: 0, trajectory: 0 }
    for (const ev of all) counts[ev.name]++
    expect(counts.state).toBeLessThanOrEqual(3)
    expect(counts.budget).toBeLessThanOrEqual(3)
    expect(counts.trajectory).toBeLessThanOrEqual(3)
  })
})
