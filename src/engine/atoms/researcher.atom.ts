import { compose, model_call, sequence, step, type Engine, type GenerateResult, type Step } from "fascicle"
import {
  composeSystemPrompt,
  type StableInputs,
} from "./_shape"
import { createAtomPromptDocument } from "./_prompt.document"

export type ResearcherSpecialistDraft = {
  readonly perspective: string
  readonly draft: string
}

export type ResearcherArgs = {
  readonly specMd: string
  readonly buildDir: string
  readonly drafts: ReadonlyArray<ResearcherSpecialistDraft>
  readonly existingResearchMd?: string | null
  readonly changelogMd?: string | null
  readonly iterationNumber: number
}

export const shapeResearcherModelCallInput = (args: ResearcherArgs): string => {
  const doc = createAtomPromptDocument()

  doc.data("spec.md", args.specMd)

  const reportLines: string[] = []
  for (const { perspective, draft } of args.drafts) {
    reportLines.push(`### ${perspective.charAt(0).toUpperCase() + perspective.slice(1)} Specialist Report\n`)
    reportLines.push(draft)
    reportLines.push("\n---\n")
  }
  doc.data("Specialist Research Reports", reportLines.join("\n"))

  if (args.existingResearchMd) {
    doc.data("Existing research.md (to be updated, not replaced)", args.existingResearchMd)
  }

  if (args.changelogMd) {
    doc.data("spec.changelog.md (recommendations already acted on)", args.changelogMd)
  }

  doc.data("Current Iteration", `Iteration: ${args.iterationNumber}`)

  doc.instruction(
    "Output",
    `Write the ${args.existingResearchMd ? "updated" : "new"} research report to: ${args.buildDir}/research.md\nUse the Write tool to create the file.`,
  )

  return doc.render()
}

export type ResearcherAtomDeps = {
  readonly engine: Engine
  readonly model: string
  readonly roleSystem: string
  readonly stable?: StableInputs | null
}

export const researcherAtom = (deps: ResearcherAtomDeps): Step<ResearcherArgs, GenerateResult<unknown>> => {
  const system = composeSystemPrompt(deps.roleSystem, deps.stable)
  const shaper = step("researcher.shape", (args: ResearcherArgs) => shapeResearcherModelCallInput(args))
  const caller = model_call({ engine: deps.engine, model: deps.model, system })
  return compose("researcher", sequence([shaper, caller]))
}
