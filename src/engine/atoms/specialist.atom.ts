import { compose, model_call, sequence, step, type Engine, type GenerateResult, type Step } from "fascicle"
import {
  composeSystemPrompt,
  type StableInputs,
} from "./_shape.js"
import { createAtomPromptDocument } from "./_prompt.document.js"

export type SpecialistExtraSection = {
  readonly heading: string
  readonly content: string
}

export type SpecialistArgs = {
  readonly userPrompt: string
  readonly extraSections?: ReadonlyArray<SpecialistExtraSection> | null
}

export const shapeSpecialistModelCallInput = (args: SpecialistArgs): string => {
  if (!args.extraSections || args.extraSections.length === 0) {
    return args.userPrompt
  }
  const doc = createAtomPromptDocument()
  for (const section of args.extraSections) {
    doc.data(section.heading, section.content)
  }
  return `${args.userPrompt}\n\n${doc.render()}`
}

export type SpecialistAtomDeps = {
  readonly engine: Engine
  readonly model: string
  /** Specialist overlay merged with the JSON directive (or stage role). */
  readonly roleSystem: string
  readonly stable?: StableInputs | null
}

export const specialistAtom = (
  deps: SpecialistAtomDeps,
): Step<SpecialistArgs, GenerateResult<unknown>> => {
  const system = composeSystemPrompt(deps.roleSystem, deps.stable)
  const shaper = step("specialist.shape", (args: SpecialistArgs) => shapeSpecialistModelCallInput(args))
  const caller = model_call({ engine: deps.engine, model: deps.model, system })
  return compose("specialist", sequence([shaper, caller]))
}
