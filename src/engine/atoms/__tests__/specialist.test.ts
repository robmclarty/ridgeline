import { describe, it, expect } from "vitest"
import { run } from "fascicle"
import { specialistAtom, type SpecialistArgs } from "../specialist.atom"
import { cannedGenerateResult, stubEngine } from "./_stub.engine"

const baseArgs: SpecialistArgs = {
  userPrompt: "## shape.md\n\n<!-- role: data -->\nThe shape\n",
}

describe("specialistAtom", () => {
  it("invokes engine.generate with the user prompt verbatim and resolved system", async () => {
    const engine = stubEngine(cannedGenerateResult("draft text"))
    const atom = specialistAtom({ engine, model: "opus", roleSystem: "You are a planner specialist." })
    const result = await run(atom, baseArgs, { install_signal_handlers: false })
    expect(result.content).toBe("draft text")
    expect(engine.generate).toHaveBeenCalledTimes(1)
    const opts = engine.generate.mock.calls[0]![0]
    expect(opts.system).toContain("You are a planner specialist.")
    expect(opts.schema).toBeUndefined()
    const promptText = typeof opts.prompt === "string"
      ? opts.prompt
      : (opts.prompt[0]?.content as Array<{ text?: string }>)?.[0]?.text ?? ""
    expect(promptText).toBe(baseArgs.userPrompt)
  })

  it("appends extra sections after the user prompt when provided", async () => {
    const engine = stubEngine(cannedGenerateResult("ok"))
    const atom = specialistAtom({ engine, model: "opus", roleSystem: "sys" })
    await run(
      atom,
      {
        userPrompt: "User prompt body",
        extraSections: [{ heading: "Cross-Specialist Annotations", content: "Some annotation text" }],
      },
      { install_signal_handlers: false },
    )
    const opts = engine.generate.mock.calls[0]![0]
    const promptText = typeof opts.prompt === "string"
      ? opts.prompt
      : (opts.prompt[0]?.content as Array<{ text?: string }>)?.[0]?.text ?? ""
    expect(promptText).toContain("User prompt body")
    expect(promptText).toContain("## Cross-Specialist Annotations")
    expect(promptText).toContain("Some annotation text")
  })
})
