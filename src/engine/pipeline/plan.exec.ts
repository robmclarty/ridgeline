import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig } from "../../types"
import { appendConstraintsAndTaste, appendDesign } from "./pipeline.shared"
import { PromptDocument } from "./prompt.document"

/** Append the shared portion of the user prompt: spec, constraints, taste, design, target model. */
export const appendBaseUserPrompt = (doc: PromptDocument, config: RidgelineConfig): void => {
  const specPath = path.join(config.buildDir, "spec.md")
  doc.data("spec.md", fs.readFileSync(specPath, "utf-8"))

  appendConstraintsAndTaste(doc, config)
  appendDesign(doc, config)

  doc.instruction("Target Model", `The builder will use the \`${config.model}\` model.`)
}

/** Assemble the shared portion of the user prompt as a rendered string. */
export const assembleBaseUserPrompt = (config: RidgelineConfig): string => {
  const doc = new PromptDocument()
  appendBaseUserPrompt(doc, config)
  return doc.render()
}
