import { describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir, trackTempDir } from "../../../../test/setup.js"
import { watchAppend, watchJson } from "../watcher.js"

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe("watchJson", () => {
  it("debounces and emits only when parsed content changes", async () => {
    const dir = trackTempDir(makeTempDir())
    const fp = path.join(dir, "state.json")
    fs.writeFileSync(fp, JSON.stringify({ v: 1 }))
    const seen: unknown[] = []
    const w = watchJson(fp, (p) => seen.push(p), 20)
    w.start()
    fs.writeFileSync(fp, JSON.stringify({ v: 2 }))
    await sleep(100)
    fs.writeFileSync(fp, JSON.stringify({ v: 2 }))
    await sleep(100)
    w.stop()
    expect(seen.length).toBeGreaterThanOrEqual(1)
    expect((seen[seen.length - 1] as { v: number }).v).toBe(2)
  })
})

describe("watchAppend", () => {
  it("reads only appended lines via byte-offset tracker", async () => {
    const dir = trackTempDir(makeTempDir())
    const fp = path.join(dir, "trajectory.jsonl")
    fs.writeFileSync(fp, JSON.stringify({ a: 1 }) + "\n")
    const seen: string[] = []
    const w = watchAppend(fp, (lines) => { for (const l of lines) seen.push(l) })
    w.start()
    const initialOffset = w.offset()
    expect(initialOffset).toBeGreaterThan(0)
    fs.appendFileSync(fp, JSON.stringify({ b: 2 }) + "\n")
    await sleep(100)
    fs.appendFileSync(fp, JSON.stringify({ c: 3 }) + "\n")
    await sleep(100)
    w.stop()
    expect(seen).toEqual([
      JSON.stringify({ b: 2 }),
      JSON.stringify({ c: 3 }),
    ])
    expect(w.offset()).toBeGreaterThan(initialOffset)
  })
})
