import { describe, it, expect } from "vitest"
import { run } from "fascicle"
import { builderAtom, type BuilderArgs } from "../builder.atom"
import { cannedGenerateResult, stubEngine } from "./_stub.engine"

const minimalArgs: BuilderArgs = {
  constraintsMd: "# Constraints",
  tasteMd: null,
  phaseMd: "# Phase 1",
  handoffTargetPath: "/tmp/h.md",
  discoveriesSection: "empty",
}

describe("builderAtom", () => {
  it("invokes engine.generate with the shaper output and resolved system", async () => {
    const engine = stubEngine(cannedGenerateResult("done"))
    const atom = builderAtom({
      engine,
      model: "opus",
      roleSystem: "You are a builder.",
      stable: { constraintsMd: minimalArgs.constraintsMd, tasteMd: null, specMd: null },
    })
    const result = await run(atom, minimalArgs, { install_signal_handlers: false })
    expect(result.content).toBe("done")
    expect(engine.generate).toHaveBeenCalledTimes(1)
    const opts = engine.generate.mock.calls[0]![0]
    expect(opts.system).toContain("You are a builder.")
    expect(opts.system).toContain("## constraints.md")
    const prompt = opts.prompt
    const promptText =
      typeof prompt === "string"
        ? prompt
        : (prompt[0]?.content as Array<{ text?: string }>)?.[0]?.text
    expect(promptText).toContain("# Phase 1")
  })

  it("does not pass a schema to model_call", async () => {
    const engine = stubEngine(cannedGenerateResult("ok"))
    const atom = builderAtom({ engine, model: "opus", roleSystem: "sys" })
    await run(atom, minimalArgs, { install_signal_handlers: false })
    const opts = engine.generate.mock.calls[0]![0]
    expect(opts.schema).toBeUndefined()
  })
})
