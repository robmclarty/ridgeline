import { describe, it, expect } from "vitest"
import { run } from "fascicle"
import { researcherAtom, type ResearcherArgs } from "../researcher.atom"
import { cannedGenerateResult, stubEngine } from "./_stub.engine"

const args: ResearcherArgs = {
  specMd: "# Spec",
  buildDir: "/tmp/build",
  drafts: [
    { perspective: "academic", draft: "academic findings" },
    { perspective: "practitioner", draft: "practitioner findings" },
  ],
  iterationNumber: 1,
}

describe("researcherAtom", () => {
  it("renders specialist drafts and writes-to instructions in the prompt", async () => {
    const engine = stubEngine(cannedGenerateResult("done"))
    const atom = researcherAtom({ engine, model: "opus", roleSystem: "research" })
    await run(atom, args, { install_signal_handlers: false })
    expect(engine.generate).toHaveBeenCalledTimes(1)
    const opts = engine.generate.mock.calls[0]![0]
    const promptText = typeof opts.prompt === "string"
      ? opts.prompt
      : (opts.prompt[0]?.content as Array<{ text?: string }>)?.[0]?.text ?? ""
    expect(promptText).toContain("Academic Specialist Report")
    expect(promptText).toContain("Practitioner Specialist Report")
    expect(promptText).toContain("/tmp/build/research.md")
  })
})
