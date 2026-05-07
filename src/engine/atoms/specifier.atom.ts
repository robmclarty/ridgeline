import { compose, model_call, sequence, step, type Engine, type GenerateResult, type Step } from "fascicle"
import {
  composeSystemPrompt,
  type StableInputs,
} from "./_shape"
import { createAtomPromptDocument } from "./_prompt.document"

export type SpecifierProposalDraft = {
  readonly perspective: string
  readonly proposalMarkdown: string
}

export type SpecifierArgs = {
  readonly shapeMd: string
  readonly userInput?: string | null
  readonly drafts: ReadonlyArray<SpecifierProposalDraft>
  readonly buildDir: string
  readonly inferGapFlagging?: boolean
}

const SPEC_USER_INPUT_AUTHORITY = [
  "The user has provided an existing spec draft (above) as authoritative source material.",
  "Treat it as higher priority than the specialist proposals: preserve the user's detail, features, acceptance criteria, constraints, and taste preferences wherever they do not contradict shape.md.",
  "Use the specialist proposals to sharpen, enrich, and fill gaps — do not replace the user's draft with a rewrite.",
  "If specialists and the user draft disagree on a non-conflicting detail, favor the user draft.",
].join(" ")

const SPEC_GAP_FLAGGING_INSTRUCTION = [
  "When writing each output file, append a final section titled `## Inferred / Gaps`.",
  "Under that heading list every load-bearing fact in the file you inferred without the user's input or shape.md directly stating it.",
  "Use one bullet per item: `- <fact> — inferred because: <one-line reason>`.",
  "If every load-bearing fact is source-backed, write `(none)`.",
  "The user will edit this section to confirm or override your guesses before plan runs.",
].join(" ")

export const shapeSpecifierModelCallInput = (args: SpecifierArgs): string => {
  const doc = createAtomPromptDocument()

  doc.data("shape.md", args.shapeMd)

  if (args.userInput) {
    doc.data("User-Provided Spec Draft", args.userInput)
    doc.instruction("Authority of User Input", SPEC_USER_INPUT_AUTHORITY)
  }

  const proposalLines: string[] = []
  for (const { perspective, proposalMarkdown } of args.drafts) {
    proposalLines.push(`### ${perspective.charAt(0).toUpperCase() + perspective.slice(1)} Specialist Proposal\n`)
    proposalLines.push(proposalMarkdown)
    proposalLines.push("\n---\n")
  }
  doc.data("Specialist Proposals", proposalLines.join("\n"))

  doc.instruction(
    "Output Directory",
    `Write spec.md, constraints.md, and optionally taste.md to: ${args.buildDir}/\nUse the Write tool to create each file.`,
  )

  if (args.inferGapFlagging) {
    doc.instruction("Gap Flagging", SPEC_GAP_FLAGGING_INSTRUCTION)
  }

  return doc.render()
}

export type SpecifierAtomDeps = {
  readonly engine: Engine
  readonly model: string
  readonly roleSystem: string
  readonly stable?: StableInputs | null
}

export const specifierAtom = (
  deps: SpecifierAtomDeps,
): Step<SpecifierArgs, GenerateResult<unknown>> => {
  const system = composeSystemPrompt(deps.roleSystem, deps.stable)
  const shaper = step("specifier.shape", (args: SpecifierArgs) => shapeSpecifierModelCallInput(args))
  const caller = model_call({ engine: deps.engine, model: deps.model, system })
  return compose("specifier", sequence([shaper, caller]))
}
