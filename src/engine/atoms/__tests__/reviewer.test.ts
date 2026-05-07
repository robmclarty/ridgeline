import { describe, it, expect } from "vitest"
import { run } from "fascicle"
import { reviewerAtom, type ReviewerArgs } from "../reviewer.atom"
import { reviewVerdictSchema } from "../../schemas"
import { cannedGenerateResult, stubEngine } from "./_stub.engine"

const cannedVerdict = {
  passed: true,
  summary: "ok",
  criteriaResults: [],
  issues: [],
  suggestions: [],
}

const args: ReviewerArgs = {
  phaseMd: "# Phase 1",
  diff: null,
  constraintsMd: "# Constraints",
}

describe("reviewerAtom", () => {
  it("passes reviewVerdictSchema referentially to model_call", async () => {
    const engine = stubEngine(cannedGenerateResult(cannedVerdict))
    const atom = reviewerAtom({ engine, model: "opus", roleSystem: "review" })
    await run(atom, args, { install_signal_handlers: false })
    expect(engine.generate).toHaveBeenCalledTimes(1)
    const opts = engine.generate.mock.calls[0]![0]
    expect(opts.schema).toBe(reviewVerdictSchema)
  })

  it("renders shaper output containing the diff section", async () => {
    const engine = stubEngine(cannedGenerateResult(cannedVerdict))
    const atom = reviewerAtom({ engine, model: "opus", roleSystem: "review" })
    await run(
      atom,
      { ...args, diff: "diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n" },
      { install_signal_handlers: false },
    )
    const opts = engine.generate.mock.calls[0]![0]
    const promptText = typeof opts.prompt === "string"
      ? opts.prompt
      : (opts.prompt[0]?.content as Array<{ text?: string }>)?.[0]?.text ?? ""
    expect(promptText).toContain("Git Diff (checkpoint to HEAD)")
    expect(promptText).toContain("```diff")
  })
})
