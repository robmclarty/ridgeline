import { compose, model_call, sequence, step, type Engine, type GenerateResult, type Step } from "fascicle"
import {
  appendConstraintsAndTasteData,
  appendDesignData,
  composeSystemPrompt,
  type StableInputs,
} from "./_shape"
import { createAtomPromptDocument } from "./_prompt.document"
import { planArtifactSchema, type PlanArtifactSchema } from "../schemas"

const PLANNER_JSON_DIRECTIVE = [
  "",
  "## Your Task",
  "",
  "Decompose the spec into sequential phases. Return your plan as a single JSON object.",
  "Do NOT use the Write tool. Do NOT produce markdown. Do NOT write prose or commentary.",
  "Your entire response must be valid JSON matching the provided schema.",
  "",
  "Each phase in your JSON must include:",
  "- `title`: Phase name",
  "- `slug`: Kebab-case identifier for file naming",
  "- `goal`: 1-3 paragraphs describing what this phase accomplishes (business/product terms, no implementation details)",
  "- `acceptanceCriteria`: Array of concrete, verifiable outcomes",
  "- `specReference`: Relevant spec sections",
  "- `rationale`: Why this phase boundary exists",
  "",
  "Also include your `perspective` label, a `summary` of your approach, and the `tradeoffs` of your plan.",
  "",
  "Finally include a `_skeleton` field summarizing your plan:",
  "- `phaseList`: array of { id, slug } entries in sequential order; id is `NN-<slug>` (two-digit index).",
  "- `depGraph`: array of [from, to] id pairs describing cross-phase dependencies.",
  "The `_skeleton` is used for ensemble agreement detection; keep it faithful to the main plan.",
].join("\n")

export type PlannerArgs = {
  readonly specMd: string
  readonly constraintsMd: string
  readonly tasteMd?: string | null
  readonly extraContext?: string | null
  readonly projectDesignMd?: string | null
  readonly featureDesignMd?: string | null
  readonly model: string
  readonly phaseTokenLimit: number
  readonly phaseBudgetLimit?: number | null
}

export const shapePlannerModelCallInput = (args: PlannerArgs): string => {
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

  doc.instruction(
    "Output Format",
    "IMPORTANT: Respond with ONLY a JSON object. No prose, no markdown, no commentary. Just the JSON.",
  )

  return doc.render()
}

export type PlannerAtomDeps = {
  readonly engine: Engine
  readonly model: string
  /** Specialist system context — prepended to the JSON directive. */
  readonly roleSystem: string
  readonly stable?: StableInputs | null
}

export const plannerAtom = (
  deps: PlannerAtomDeps,
): Step<PlannerArgs, GenerateResult<PlanArtifactSchema>> => {
  const roleSystem = `${deps.roleSystem}${PLANNER_JSON_DIRECTIVE}`
  const system = composeSystemPrompt(roleSystem, deps.stable)
  const shaper = step("planner.shape", (args: PlannerArgs) => shapePlannerModelCallInput(args))
  const caller = model_call({
    engine: deps.engine,
    model: deps.model,
    system,
    schema: planArtifactSchema,
  })
  return compose("planner", sequence([shaper, caller]))
}
