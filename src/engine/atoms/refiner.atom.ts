import { compose, model_call, sequence, step, type Engine, type GenerateResult, type Step } from "fascicle"
import {
  composeSystemPrompt,
  type StableInputs,
} from "./_shape.js"
import { createAtomPromptDocument } from "./_prompt.document.js"

export type RefinerArgs = {
  readonly specMd: string
  readonly researchMd: string
  readonly constraintsMd: string
  readonly tasteMd?: string | null
  readonly changelogMd?: string | null
  readonly buildDir: string
  readonly iterationNumber: number
}

export const shapeRefinerModelCallInput = (args: RefinerArgs): string => {
  const doc = createAtomPromptDocument()

  doc.data("spec.md", args.specMd)
  doc.data("research.md", args.researchMd)

  if (args.changelogMd) {
    doc.data("spec.changelog.md (your prior changes)", args.changelogMd)
  }

  doc.data("constraints.md", args.constraintsMd)
  if (args.tasteMd) {
    doc.data("taste.md", args.tasteMd)
  }

  doc.instruction(
    "Output",
    `1. Rewrite the spec incorporating research findings. Write the revised spec to: ${args.buildDir}/spec.md\n` +
    `2. Document your changes. Write the changelog to: ${args.buildDir}/spec.changelog.md\n` +
    `   - ${args.changelogMd ? "Read the existing spec.changelog.md first, then prepend" : "Create"} a new ## Iteration ${args.iterationNumber} section.\n` +
    "Use the Write tool for both files.",
  )

  return doc.render()
}

export type RefinerAtomDeps = {
  readonly engine: Engine
  readonly model: string
  readonly roleSystem: string
  readonly stable?: StableInputs | null
}

export const refinerAtom = (deps: RefinerAtomDeps): Step<RefinerArgs, GenerateResult<unknown>> => {
  const system = composeSystemPrompt(deps.roleSystem, deps.stable)
  const shaper = step("refiner.shape", (args: RefinerArgs) => shapeRefinerModelCallInput(args))
  const caller = model_call({ engine: deps.engine, model: deps.model, system })
  return compose("refiner", sequence([shaper, caller]))
}
