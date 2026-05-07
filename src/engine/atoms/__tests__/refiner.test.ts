import { describe, it, expect } from "vitest"
import { run } from "fascicle"
import { refinerAtom, type RefinerArgs } from "../refiner.atom.js"
import { cannedGenerateResult, stubEngine } from "./_stub.engine.js"

const args: RefinerArgs = {
  specMd: "# Spec",
  researchMd: "# Research",
  constraintsMd: "# Constraints",
  buildDir: "/tmp/build",
  iterationNumber: 2,
}

describe("refinerAtom", () => {
  it("invokes engine.generate with refiner output instructions in the prompt", async () => {
    const engine = stubEngine(cannedGenerateResult("done"))
    const atom = refinerAtom({ engine, model: "opus", roleSystem: "refine" })
    await run(atom, args, { install_signal_handlers: false })
    expect(engine.generate).toHaveBeenCalledTimes(1)
    const opts = engine.generate.mock.calls[0]![0]
    const promptText = typeof opts.prompt === "string"
      ? opts.prompt
      : (opts.prompt[0]?.content as Array<{ text?: string }>)?.[0]?.text ?? ""
    expect(promptText).toContain("/tmp/build/spec.md")
    expect(promptText).toContain("Iteration 2")
  })
})
