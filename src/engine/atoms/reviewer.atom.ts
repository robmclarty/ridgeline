import { compose, model_call, sequence, step, type Engine, type GenerateResult, type Step } from "fascicle"
import {
  appendDesignData,
  composeSystemPrompt,
  type StableInputs,
} from "./_shape"
import { createAtomPromptDocument } from "./_prompt.document"
import { reviewVerdictSchema, type ReviewVerdictSchema } from "../schemas"

export type ReviewerSensorFinding = {
  readonly severity: string
  readonly kind: string
  readonly summary: string
  readonly path?: string | null
}

export type ReviewerShapeContext = {
  readonly name: string
  readonly reviewerContext: string
}

export type ReviewerArgs = {
  readonly phaseMd: string
  readonly diff: string | null
  readonly constraintsMd: string
  readonly projectDesignMd?: string | null
  readonly featureDesignMd?: string | null
  readonly sensorFindings?: ReadonlyArray<ReviewerSensorFinding> | null
  readonly matchedShapeContexts?: ReadonlyArray<ReviewerShapeContext> | null
}

export const shapeReviewerModelCallInput = (args: ReviewerArgs): string => {
  const doc = createAtomPromptDocument()

  doc.data("Phase Spec", args.phaseMd)

  if (args.diff && args.diff.length > 0) {
    doc.dataFenced("Git Diff (checkpoint to HEAD)", args.diff, "diff")
  } else {
    doc.data("Git Diff (checkpoint to HEAD)", "No changes detected.")
  }

  doc.data("constraints.md", args.constraintsMd)

  appendDesignData(doc, args)

  if (args.sensorFindings && args.sensorFindings.length > 0) {
    const lines: string[] = []
    for (const finding of args.sensorFindings) {
      const pathPart = finding.path ? ` (${finding.path})` : ""
      lines.push(`- [${finding.severity}] ${finding.kind}: ${finding.summary}${pathPart}`)
    }
    doc.data("Sensor Findings (from builder loop)", lines.join("\n"))
  }

  if (args.matchedShapeContexts && args.matchedShapeContexts.length > 0) {
    const lines: string[] = []
    lines.push("The following visual design heuristics apply to this phase:\n")
    for (const ctx of args.matchedShapeContexts) {
      lines.push(`### ${ctx.name}\n`)
      lines.push(ctx.reviewerContext)
      lines.push("")
    }
    lines.push("**Review rules for design.md:**")
    lines.push("- Hard token violations (specific values with imperative language) → severity: blocking")
    lines.push("- Soft guidance deviations (directional language) → severity: suggestion")
    doc.instruction("Visual Design Review Context", lines.join("\n"))
  }

  return doc.render()
}

export type ReviewerAtomDeps = {
  readonly engine: Engine
  readonly model: string
  readonly roleSystem: string
  readonly stable?: StableInputs | null
}

export const reviewerAtom = (
  deps: ReviewerAtomDeps,
): Step<ReviewerArgs, GenerateResult<ReviewVerdictSchema>> => {
  const system = composeSystemPrompt(deps.roleSystem, deps.stable)
  const shaper = step("reviewer.shape", (args: ReviewerArgs) => shapeReviewerModelCallInput(args))
  const caller = model_call({
    engine: deps.engine,
    model: deps.model,
    system,
    schema: reviewVerdictSchema,
  })
  return compose("reviewer", sequence([shaper, caller]))
}
