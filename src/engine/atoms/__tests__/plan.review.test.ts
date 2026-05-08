import { describe, it, expect } from "vitest"
import { run } from "fascicle"
import { planReviewAtom, type PlanReviewArgs } from "../plan.review.atom.js"
import { planReviewSchema } from "../../schemas.js"
import { cannedGenerateResult, stubEngine } from "./_stub.engine.js"

const cannedVerdict = { approved: true, issues: [] }

const args: PlanReviewArgs = {
  specMd: "# Spec\n",
  constraintsMd: "# Constraints\n",
  tasteMd: null,
  model: "opus",
  phaseTokenLimit: 50000,
  phaseBudgetLimit: null,
  phasesMd: "### 01-foo.md\n\n# Phase 1\n",
}

describe("planReviewAtom", () => {
  it("passes planReviewSchema referentially to model_call", async () => {
    const engine = stubEngine(cannedGenerateResult(cannedVerdict))
    const atom = planReviewAtom({ engine, model: "opus", roleSystem: "review the plan" })
    await run(atom, args, { install_signal_handlers: false })
    expect(engine.generate).toHaveBeenCalledTimes(1)
    const opts = engine.generate.mock.calls[0]![0]
    expect(opts.schema).toBe(planReviewSchema)
  })

  it("renders the plan-reviewer prompt with synthesized phases", async () => {
    const engine = stubEngine(cannedGenerateResult(cannedVerdict))
    const atom = planReviewAtom({ engine, model: "opus", roleSystem: "review the plan" })
    await run(atom, args, { install_signal_handlers: false })
    const opts = engine.generate.mock.calls[0]![0]
    const promptText = typeof opts.prompt === "string"
      ? opts.prompt
      : (opts.prompt[0]?.content as Array<{ text?: string }>)?.[0]?.text ?? ""
    expect(promptText).toContain("## spec.md")
    expect(promptText).toContain("## Synthesized Plan (phase files)")
    expect(promptText).toContain("Output Format")
  })
})
