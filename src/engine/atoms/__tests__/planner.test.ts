import { describe, it, expect } from "vitest"
import { run } from "fascicle"
import { plannerAtom, type PlannerArgs } from "../planner.atom"
import { planArtifactSchema } from "../../schemas"
import { cannedGenerateResult, stubEngine } from "./_stub.engine"

const cannedPlan = {
  perspective: "stub",
  summary: "s",
  phases: [],
  tradeoffs: "t",
  _skeleton: { phaseList: [], depGraph: [] },
}

const args: PlannerArgs = {
  specMd: "# Spec",
  constraintsMd: "# Constraints",
  model: "opus",
  phaseTokenLimit: 50000,
  phaseBudgetLimit: null,
}

describe("plannerAtom", () => {
  it("passes planArtifactSchema referentially to model_call", async () => {
    const engine = stubEngine(cannedGenerateResult(cannedPlan))
    const atom = plannerAtom({ engine, model: "opus", roleSystem: "planner" })
    await run(atom, args, { install_signal_handlers: false })
    expect(engine.generate).toHaveBeenCalledTimes(1)
    const opts = engine.generate.mock.calls[0]![0]
    expect(opts.schema).toBe(planArtifactSchema)
  })

  it("appends the JSON directive to the role system", async () => {
    const engine = stubEngine(cannedGenerateResult(cannedPlan))
    const atom = plannerAtom({ engine, model: "opus", roleSystem: "planner-role" })
    await run(atom, args, { install_signal_handlers: false })
    const opts = engine.generate.mock.calls[0]![0]
    expect(opts.system).toContain("planner-role")
    expect(opts.system).toContain("Your entire response must be valid JSON")
  })
})
