import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { run, checkpoint, compose, step } from "fascicle"
import { createRidgelineCheckpointStore } from "../../adapters/ridgeline_checkpoint_store.js"
import { saveState, loadState, initState } from "../../../stores/state.js"
import type { PhaseInfo } from "../../../types.js"

describe("Cross-process resume invariant (Phase 9)", () => {
  let dir: string
  let buildDir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-resume-"))
    buildDir = path.join(dir, ".ridgeline", "builds", "t")
    fs.mkdirSync(buildDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("CheckpointStore writes only under <buildDir>/state/, never to state.json", async () => {
    const phases: PhaseInfo[] = [
      { id: "p1", index: 1, slug: "p1", filename: "p1.md", filepath: "/p1.md", dependsOn: [] },
    ]
    const initial = initState("t", phases)
    saveState(buildDir, initial)
    const initialBytes = fs.readFileSync(path.join(buildDir, "state.json"), "utf-8")

    const store = createRidgelineCheckpointStore({ buildDir })
    const flow = compose(
      "resume_test",
      checkpoint(
        step<{ readonly v: number }, { readonly v: number }>("memo", (input) => ({ v: input.v + 1 })),
        { key: "memo_step" },
      ),
    )

    const out = await run(
      flow,
      { v: 1 },
      { checkpoint_store: store, install_signal_handlers: false },
    )
    expect(out.v).toBe(2)

    // state.json is byte-equal to its pre-run content
    const finalBytes = fs.readFileSync(path.join(buildDir, "state.json"), "utf-8")
    expect(finalBytes).toBe(initialBytes)

    // CheckpointStore wrote a per-step file under <buildDir>/state/
    const stateDir = path.join(buildDir, "state")
    expect(fs.existsSync(stateDir)).toBe(true)
    const checkpointFiles = fs.readdirSync(stateDir)
    expect(checkpointFiles.length).toBeGreaterThan(0)
    for (const f of checkpointFiles) {
      expect(f.endsWith(".json")).toBe(true)
    }
  })

  it("state.json from a prior process can be loaded after the inner run completes (outer resume layer untouched)", async () => {
    const phases: PhaseInfo[] = [
      { id: "p1", index: 1, slug: "p1", filename: "p1.md", filepath: "/p1.md", dependsOn: [] },
      { id: "p2", index: 2, slug: "p2", filename: "p2.md", filepath: "/p2.md", dependsOn: [] },
    ]
    const initial = initState("t", phases)
    initial.phases[0].status = "complete"
    initial.phases[0].completedAt = "2024-01-01T00:00:00.000Z"
    initial.phases[0].duration = 1000
    saveState(buildDir, initial)

    const store = createRidgelineCheckpointStore({ buildDir })
    const flow = compose(
      "memo_test",
      checkpoint(step("inc", (n: number) => n + 1), { key: "inc_step" }),
    )
    await run(flow, 1, { checkpoint_store: store, install_signal_handlers: false })

    // Outer resume: load state.json with the same buildName + phase set; phases[0]
    // is still 'complete' from the prior process.
    const reloaded = loadState(buildDir, "t", phases)
    expect(reloaded).not.toBeNull()
    const completed = reloaded!.phases.find((p) => p.id === "p1")
    expect(completed?.status).toBe("complete")
  })
})
