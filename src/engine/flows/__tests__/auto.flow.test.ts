import { describe, it, expect } from "vitest"
import { run } from "fascicle"
import { autoFlow, type AutoStage, type AutoStageOutcome } from "../auto.flow.js"

const stageList = (stages: AutoStage[]): (() => AsyncIterable<AutoStage>) =>
  async function* () {
    for (const s of stages) yield s
  }

describe("autoFlow", () => {
  it("runs each stage in order", async () => {
    const seen: string[] = []
    const flow = autoFlow({
      stages: stageList([
        { name: "shape", run: async () => { seen.push("shape"); return "ran" } },
        { name: "spec", run: async () => { seen.push("spec"); return "ran" } },
        { name: "plan", run: async () => { seen.push("plan"); return "ran" } },
      ]),
    })
    const out = await run(flow, { buildName: "t", buildDir: "/tmp" }, { install_signal_handlers: false })
    expect(seen).toEqual(["shape", "spec", "plan"])
    expect(out.halted).toBe(false)
    expect(out.stages.map((s) => s.name)).toEqual(["shape", "spec", "plan"])
  })

  it("halts when a stage returns 'halted'", async () => {
    const seen: string[] = []
    const flow = autoFlow({
      stages: stageList([
        { name: "shape", run: async () => { seen.push("shape"); return "ran" as AutoStageOutcome } },
        { name: "spec", run: async () => { seen.push("spec"); return "halted" as AutoStageOutcome } },
        { name: "plan", run: async () => { seen.push("plan"); return "ran" as AutoStageOutcome } },
      ]),
    })
    const out = await run(flow, { buildName: "t", buildDir: "/tmp" }, { install_signal_handlers: false })
    expect(seen).toEqual(["shape", "spec"])
    expect(out.halted).toBe(true)
  })
})
