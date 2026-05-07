import { describe, it, expect } from "vitest"
import { run } from "fascicle"
import { specifierAtom, type SpecifierArgs } from "../specifier.atom.js"
import { cannedGenerateResult, stubEngine } from "./_stub.engine.js"

const args: SpecifierArgs = {
  shapeMd: "# Shape\n\nThe shape.\n",
  drafts: [
    { perspective: "feature", proposalMarkdown: "Feature proposal text" },
    { perspective: "constraints", proposalMarkdown: "Constraints proposal text" },
  ],
  buildDir: "/tmp/build",
}

describe("specifierAtom", () => {
  it("renders shape, drafts, and output-directory instruction", async () => {
    const engine = stubEngine(cannedGenerateResult("ok"))
    const atom = specifierAtom({ engine, model: "opus", roleSystem: "You are the specifier." })
    await run(atom, args, { install_signal_handlers: false })
    expect(engine.generate).toHaveBeenCalledTimes(1)
    const opts = engine.generate.mock.calls[0]![0]
    expect(opts.system).toContain("You are the specifier.")
    expect(opts.schema).toBeUndefined()
    const promptText = typeof opts.prompt === "string"
      ? opts.prompt
      : (opts.prompt[0]?.content as Array<{ text?: string }>)?.[0]?.text ?? ""
    expect(promptText).toContain("## shape.md")
    expect(promptText).toContain("Feature proposal text")
    expect(promptText).toContain("Constraints proposal text")
    expect(promptText).toContain("/tmp/build/")
  })

  it("includes the user-input authority block and gap-flagging instruction when configured", async () => {
    const engine = stubEngine(cannedGenerateResult("ok"))
    const atom = specifierAtom({ engine, model: "opus", roleSystem: "sys" })
    await run(
      atom,
      { ...args, userInput: "User-authored draft", inferGapFlagging: true },
      { install_signal_handlers: false },
    )
    const opts = engine.generate.mock.calls[0]![0]
    const promptText = typeof opts.prompt === "string"
      ? opts.prompt
      : (opts.prompt[0]?.content as Array<{ text?: string }>)?.[0]?.text ?? ""
    expect(promptText).toContain("## User-Provided Spec Draft")
    expect(promptText).toContain("Authority of User Input")
    expect(promptText).toContain("Gap Flagging")
    expect(promptText).toContain("Inferred / Gaps")
  })
})
