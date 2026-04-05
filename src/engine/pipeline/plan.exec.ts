import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig } from "../../types"
import { appendConstraintsAndTaste } from "./pipeline.shared"

/** Assemble the shared portion of the user prompt: spec, constraints, taste, target model. */
export const assembleBaseUserPrompt = (config: RidgelineConfig): string => {
  const sections: string[] = []

  const specPath = path.join(config.buildDir, "spec.md")
  sections.push("## spec.md\n")
  sections.push(fs.readFileSync(specPath, "utf-8"))
  sections.push("")

  appendConstraintsAndTaste(sections, config)

  sections.push("## Target Model\n")
  sections.push(`The builder will use the \`${config.model}\` model.`)

  return sections.join("\n")
}
