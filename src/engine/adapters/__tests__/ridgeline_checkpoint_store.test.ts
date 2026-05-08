import { describe, it, expect, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import type { CheckpointStore } from "fascicle"
import { makeTempDir } from "../../../../test/setup.js"
import { createRidgelineCheckpointStore } from "../ridgeline_checkpoint_store.js"

describe("ridgeline_checkpoint_store", () => {
  let dir: string

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it("type-checks structurally as a fascicle CheckpointStore", () => {
    dir = makeTempDir()
    const store: CheckpointStore = createRidgelineCheckpointStore({ buildDir: dir })
    expect(typeof store.get).toBe("function")
    expect(typeof store.set).toBe("function")
    expect(typeof store.delete).toBe("function")
  })

  it("returns undefined on a checkpoint miss", async () => {
    dir = makeTempDir()
    const store = createRidgelineCheckpointStore({ buildDir: dir })
    expect(await store.get("never-set")).toBeUndefined()
  })

  it("returns the cached value on a checkpoint hit across simulated retries", async () => {
    dir = makeTempDir()
    const store = createRidgelineCheckpointStore({ buildDir: dir })

    await store.set("step-a", { round: 1, output: "first attempt" })
    expect(await store.get("step-a")).toEqual({ round: 1, output: "first attempt" })
    expect(await store.get("step-a")).toEqual({ round: 1, output: "first attempt" })
  })

  it("writes only under .ridgeline/builds/<name>/state/<step-id>.json", async () => {
    dir = makeTempDir()
    const store = createRidgelineCheckpointStore({ buildDir: dir })

    await store.set("phase-01-build", { ok: true })

    const stateFile = path.join(dir, "state", "phase-01-build.json")
    expect(fs.existsSync(stateFile)).toBe(true)
    expect(fs.existsSync(path.join(dir, "state.json"))).toBe(false)
  })

  it("never writes to state.json on get / set / delete paths", async () => {
    dir = makeTempDir()
    const store = createRidgelineCheckpointStore({ buildDir: dir })

    expect(await store.get("missing")).toBeUndefined()
    expect(fs.existsSync(path.join(dir, "state.json"))).toBe(false)

    await store.set("k", { v: 1 })
    expect(fs.existsSync(path.join(dir, "state.json"))).toBe(false)

    await store.delete("k")
    expect(fs.existsSync(path.join(dir, "state.json"))).toBe(false)
  })

  it("delete removes the persisted file and is a no-op when missing", async () => {
    dir = makeTempDir()
    const store = createRidgelineCheckpointStore({ buildDir: dir })

    await store.set("ephemeral", "value")
    const fp = path.join(dir, "state", "ephemeral.json")
    expect(fs.existsSync(fp)).toBe(true)

    await store.delete("ephemeral")
    expect(fs.existsSync(fp)).toBe(false)

    await store.delete("ephemeral")
    expect(fs.existsSync(fp)).toBe(false)
  })

  it("two-tier resume invariant: checkpoint write does not overlap with state.json", async () => {
    dir = makeTempDir()
    const store = createRidgelineCheckpointStore({ buildDir: dir })
    const { saveState } = await import("../../../stores/state.js")

    await store.set("phase-1", { resumed: true })
    saveState(dir, {
      buildName: "test",
      startedAt: new Date().toISOString(),
      pipeline: {
        shape: "complete",
        design: "skipped",
        spec: "complete",
        research: "skipped",
        refine: "skipped",
        plan: "complete",
        build: "running",
      },
      phases: [],
    })

    const checkpointFile = path.join(dir, "state", "phase-1.json")
    const stateFile = path.join(dir, "state.json")
    expect(fs.existsSync(checkpointFile)).toBe(true)
    expect(fs.existsSync(stateFile)).toBe(true)
    expect(checkpointFile).not.toBe(stateFile)
    expect(path.dirname(checkpointFile)).not.toBe(path.dirname(stateFile))
  })

  it("sanitizes step keys with filesystem-unsafe characters", async () => {
    dir = makeTempDir()
    const store = createRidgelineCheckpointStore({ buildDir: dir })

    await store.set("a/b/c", { ok: true })
    expect(await store.get("a/b/c")).toEqual({ ok: true })
    expect(fs.readdirSync(path.join(dir, "state"))).not.toContain("a")
  })
})
