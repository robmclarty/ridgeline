import { compose, model_call, sequence, step, type Engine, type GenerateResult, type Step } from "fascicle"
import {
  appendConstraintsAndTasteData,
  appendDesignData,
  composeSystemPrompt,
  type StableInputs,
} from "./_shape.js"
import { createAtomPromptDocument } from "./_prompt.document.js"
import { planReviewSchema, type PlanReviewSchema } from "../schemas.js"

export type PlanReviewArgs = {
  readonly specMd: string
  readonly constraintsMd: string
  readonly tasteMd?: string | null
  readonly extraContext?: string | null
  readonly projectDesignMd?: string | null
  readonly featureDesignMd?: string | null
  readonly model: string
  readonly phaseTokenLimit: number
  readonly phaseBudgetLimit?: number | null
  readonly phasesMd: string
}

export const shapePlanReviewModelCallInput = (args: PlanReviewArgs): string => {
  const doc = createAtomPromptDocument()

  doc.data("spec.md", args.specMd)
  appendConstraintsAndTasteData(doc, args)
  appendDesignData(doc, args)

  doc.instruction("Target Model", `The builder will use the \`${args.model}\` model.`)
  const tokenPhrase = `~${args.phaseTokenLimit.toLocaleString()} output tokens`
  const costPhrase = args.phaseBudgetLimit !== null && args.phaseBudgetLimit !== undefined
    ? ` (~$${args.phaseBudgetLimit} USD)`
    : ""
  doc.instruction(
    "Phase Budget",
    `Stay below ${tokenPhrase}${costPhrase} per phase — treat it as a hard maximum, not a target. ` +
      `Aim for 50–70% of the ceiling. If a phase would approach or exceed it, split. ` +
      `Splitting is cheap; a too-large phase risks timeout and truncation.`,
  )

  doc.data("Synthesized Plan (phase files)", args.phasesMd)
  doc.instruction(
    "Output Format",
    "Respond with ONLY a JSON object matching the schema in your system prompt. No prose, no markdown fences, no commentary.",
  )

  return doc.render()
}

export type PlanReviewAtomDeps = {
  readonly engine: Engine
  readonly model: string
  readonly roleSystem: string
  readonly stable?: StableInputs | null
}

export const planReviewAtom = (
  deps: PlanReviewAtomDeps,
): Step<PlanReviewArgs, GenerateResult<PlanReviewSchema>> => {
  const system = composeSystemPrompt(deps.roleSystem, deps.stable)
  const shaper = step("plan.review.shape", (args: PlanReviewArgs) => shapePlanReviewModelCallInput(args))
  const caller = model_call({
    engine: deps.engine,
    model: deps.model,
    system,
    schema: planReviewSchema,
  })
  return compose("plan.review", sequence([shaper, caller]))
}
