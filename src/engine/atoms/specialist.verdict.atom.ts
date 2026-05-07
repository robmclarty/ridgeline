import { compose, model_call, sequence, step, type Engine, type GenerateResult, type Step } from "fascicle"
import {
  composeSystemPrompt,
  type StableInputs,
} from "./_shape"
import { createAtomPromptDocument } from "./_prompt.document"
import { specialistVerdictSchema, type SpecialistVerdictSchema } from "../schemas"

export type SpecialistVerdictStage = "spec" | "plan" | "research"

export type SpecialistVerdictArgs = {
  readonly stage: SpecialistVerdictStage
  readonly raw: string
}

const SPEC_INSTRUCTION = [
  "Extract the structured agreement-detection skeleton for the `spec` stage.",
  "The skeleton must include:",
  "- `sectionOutline`: ordered feature/section names that structure the spec.",
  "- `riskList`: concerns and risks the synthesizer must address.",
].join("\n")

const PLAN_INSTRUCTION = [
  "Extract the structured agreement-detection skeleton for the `plan` stage.",
  "The skeleton must include:",
  "- `phaseList`: array of `{ id, slug }` entries in sequential order; id is `NN-<slug>`.",
  "- `depGraph`: array of `[from, to]` id pairs describing cross-phase dependencies.",
].join("\n")

const RESEARCH_INSTRUCTION = [
  "Extract the structured agreement-detection skeleton for the `research` stage.",
  "The skeleton must include:",
  "- `findings`: bullet-style findings the report establishes.",
  "- `openQuestions`: questions the report leaves unresolved.",
].join("\n")

const stageInstruction = (stage: SpecialistVerdictStage): string => {
  if (stage === "spec") return SPEC_INSTRUCTION
  if (stage === "plan") return PLAN_INSTRUCTION
  return RESEARCH_INSTRUCTION
}

export const shapeSpecialistVerdictModelCallInput = (args: SpecialistVerdictArgs): string => {
  const doc = createAtomPromptDocument()
  doc.data("Stage", args.stage)
  doc.data("Specialist Raw Output", args.raw)
  doc.instruction("Verdict Extraction", stageInstruction(args.stage))
  doc.instruction(
    "Output Format",
    "Respond with ONLY a JSON object matching the schema. The `stage` field MUST equal the stage above. " +
      "No prose, no markdown fences, no commentary.",
  )
  return doc.render()
}

export type SpecialistVerdictAtomDeps = {
  readonly engine: Engine
  readonly model: string
  readonly roleSystem: string
  readonly stable?: StableInputs | null
}

export const specialistVerdictAtom = (
  deps: SpecialistVerdictAtomDeps,
): Step<SpecialistVerdictArgs, GenerateResult<SpecialistVerdictSchema>> => {
  const system = composeSystemPrompt(deps.roleSystem, deps.stable)
  const shaper = step("specialist.verdict.shape", (args: SpecialistVerdictArgs) =>
    shapeSpecialistVerdictModelCallInput(args),
  )
  const caller = model_call({
    engine: deps.engine,
    model: deps.model,
    system,
    schema: specialistVerdictSchema,
  })
  return compose("specialist.verdict", sequence([shaper, caller]))
}
