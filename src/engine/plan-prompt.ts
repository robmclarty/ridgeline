import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig } from "../types.js"
import { appendConstraintsAndTaste, appendDesign } from "./legacy-shared.js"
import { createPromptDocument, PromptDocument } from "./prompt-document.js"

/** Append the shared portion of the user prompt: spec, constraints, taste, design, target model. */
export const appendBaseUserPrompt = (doc: PromptDocument, config: RidgelineConfig): void => {
  const specPath = path.join(config.buildDir, "spec.md")
  doc.data("spec.md", fs.readFileSync(specPath, "utf-8"))

  appendConstraintsAndTaste(doc, config)
  appendDesign(doc, config)

  doc.instruction("Target Model", `The builder will use the \`${config.model}\` model.`)
  const tokenPhrase = `~${config.phaseTokenLimit.toLocaleString()} output tokens`
  const costPhrase = config.phaseBudgetLimit !== null ? ` (~$${config.phaseBudgetLimit} USD)` : ""
  doc.instruction(
    "Phase Budget",
    `Stay below ${tokenPhrase}${costPhrase} per phase — treat it as a hard maximum, not a target. ` +
      `Aim for 50–70% of the ceiling. If a phase would approach or exceed it, split. ` +
      `Splitting is cheap; a too-large phase risks timeout and truncation.`,
  )
}

/** Assemble the shared portion of the user prompt as a rendered string. */
export const assembleBaseUserPrompt = (config: RidgelineConfig): string => {
  const doc = createPromptDocument()
  appendBaseUserPrompt(doc, config)
  return doc.render()
}
