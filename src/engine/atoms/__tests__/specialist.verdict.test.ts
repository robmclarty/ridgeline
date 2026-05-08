import { describe, it, expect } from "vitest"
import { run } from "fascicle"
import {
  specialistVerdictAtom,
  type SpecialistVerdictArgs,
} from "../specialist.verdict.atom.js"
import { specialistVerdictSchema } from "../../schemas.js"
import { cannedGenerateResult, stubEngine } from "./_stub.engine.js"

const cannedVerdict = {
  stage: "spec" as const,
  skeleton: { sectionOutline: ["Auth"], riskList: ["token-theft"] },
}

const args: SpecialistVerdictArgs = {
  stage: "spec",
  raw: '{"perspective":"feature","spec":{"features":[{"name":"Auth"}]}}',
}

describe("specialistVerdictAtom", () => {
  it("passes specialistVerdictSchema referentially to model_call", async () => {
    const engine = stubEngine(cannedGenerateResult(cannedVerdict))
    const atom = specialistVerdictAtom({
      engine,
      model: "opus",
      roleSystem: "extract a verdict",
    })
    await run(atom, args, { install_signal_handlers: false })
    expect(engine.generate).toHaveBeenCalledTimes(1)
    const opts = engine.generate.mock.calls[0]![0]
    expect(opts.schema).toBe(specialistVerdictSchema)
  })

  it("renders a stage-specific extraction instruction", async () => {
    const engine = stubEngine(cannedGenerateResult(cannedVerdict))
    const atom = specialistVerdictAtom({ engine, model: "opus", roleSystem: "sys" })
    await run(atom, { stage: "plan", raw: "raw planner output" }, { install_signal_handlers: false })
    const opts = engine.generate.mock.calls[0]![0]
    const promptText = typeof opts.prompt === "string"
      ? opts.prompt
      : (opts.prompt[0]?.content as Array<{ text?: string }>)?.[0]?.text ?? ""
    expect(promptText).toContain("## Stage")
    expect(promptText).toContain("plan")
    expect(promptText).toContain("phaseList")
    expect(promptText).toContain("depGraph")
    expect(promptText).toContain("raw planner output")
  })
})
