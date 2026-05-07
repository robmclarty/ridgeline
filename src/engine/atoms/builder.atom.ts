import { compose, model_call, sequence, step, type Engine, type GenerateResult, type Step } from "fascicle"
import {
  appendAssetCatalogInstruction,
  appendConstraintsAndTasteData,
  appendDesignData,
  composeSystemPrompt,
  type StableInputs,
} from "./_shape"
import { createAtomPromptDocument } from "./_prompt.document"

export type BuilderExtras = {
  readonly continuationPreamble?: string | null
  readonly budgetInstruction?: string | null
  readonly progressFilePath?: string | null
}

export type BuilderArgs = {
  readonly constraintsMd: string
  readonly tasteMd?: string | null
  readonly extraContext?: string | null
  readonly projectDesignMd?: string | null
  readonly featureDesignMd?: string | null
  readonly assetCatalogPath?: string | null
  readonly learningsMd?: string | null
  readonly handoffMd?: string | null
  readonly phaseMd: string
  readonly checkCommand?: string | null
  readonly handoffTargetPath: string
  readonly discoveriesSection: string
  readonly feedbackMd?: string | null
  readonly extras?: BuilderExtras
}

export const shapeBuilderModelCallInput = (args: BuilderArgs): string => {
  const doc = createAtomPromptDocument()

  appendConstraintsAndTasteData(doc, args)
  appendDesignData(doc, args)
  appendAssetCatalogInstruction(doc, args.assetCatalogPath)

  if (args.learningsMd && args.learningsMd.trim().length > 0) {
    doc.data("Learnings from Previous Builds", args.learningsMd.trim())
  }

  if (args.handoffMd) {
    doc.data("handoff.md", args.handoffMd)
  }

  doc.data("Phase Spec", args.phaseMd)

  if (args.checkCommand) {
    doc.instruction(
      "Check Command",
      `Run this command after making changes to verify correctness:\n\n\`\`\`\n${args.checkCommand}\n\`\`\``,
    )
  }

  doc.instruction("Handoff File", `Append your handoff notes to: ${args.handoffTargetPath}`)
  doc.instruction("Cross-Phase Discoveries", args.discoveriesSection)

  if (args.feedbackMd) {
    doc.data(
      "Reviewer Feedback (RETRY)",
      "This is a retry. The reviewer found issues with your previous attempt.\n" +
      "Focus on fixing these issues. Do not redo work that already passed.\n\n" +
      args.feedbackMd,
    )
  }

  const base = doc.render()
  return appendBuilderExtras(base, args.extras)
}

const appendBuilderExtras = (base: string, extras?: BuilderExtras): string => {
  if (!extras) return base
  const sections: string[] = [base]
  if (extras.continuationPreamble) sections.push(extras.continuationPreamble)
  if (extras.budgetInstruction) {
    sections.push("## Builder Budget", extras.budgetInstruction)
  }
  if (extras.progressFilePath) {
    sections.push(
      "## Builder Progress File",
      `Append continuation entries to: ${extras.progressFilePath}`,
    )
  }
  return sections.join("\n\n")
}

export type BuilderAtomDeps = {
  readonly engine: Engine
  readonly model: string
  readonly roleSystem: string
  readonly stable?: StableInputs | null
}

export const builderAtom = (deps: BuilderAtomDeps): Step<BuilderArgs, GenerateResult<unknown>> => {
  const system = composeSystemPrompt(deps.roleSystem, deps.stable)
  const shaper = step("builder.shape", (args: BuilderArgs) => shapeBuilderModelCallInput(args))
  const caller = model_call({ engine: deps.engine, model: deps.model, system })
  return compose("builder", sequence([shaper, caller]))
}
