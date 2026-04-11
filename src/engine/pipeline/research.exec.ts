import * as fs from "node:fs"
import * as path from "node:path"
import { EnsembleResult } from "../../types"
import { invokeEnsemble } from "./ensemble.exec"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { resolveFlavour } from "../discovery/flavour.resolve"

// ---------------------------------------------------------------------------
// Shared prompt helpers
// ---------------------------------------------------------------------------

/** Build the common spec + constraints + taste sections for research/refine prompts. */
export const assembleInputSections = (specMd: string, constraintsMd: string, tasteMd: string | null): string[] => {
  const sections: string[] = []
  sections.push("## spec.md\n")
  sections.push(specMd)
  sections.push("")
  sections.push("## constraints.md\n")
  sections.push(constraintsMd)
  sections.push("")
  if (tasteMd) {
    sections.push("## taste.md\n")
    sections.push(tasteMd)
    sections.push("")
  }
  return sections
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/** Build a research specialist system prompt from shared context + overlay. */
const buildResearchSpecialistPrompt = (context: string, overlay: string): string => {
  return `${context}\n\n${overlay}`
}

/** Assemble the user prompt for a research specialist. */
const assembleSpecialistUserPrompt = (specMd: string, constraintsMd: string, tasteMd: string | null): string => {
  const sections = assembleInputSections(specMd, constraintsMd, tasteMd)
  sections.push("Research this spec thoroughly using your web tools. Produce a markdown research report as your response.")
  return sections.join("\n")
}

/** Assemble the user prompt for the research synthesizer. */
const assembleSynthesizerUserPrompt = (
  specMd: string,
  buildDir: string,
  drafts: { perspective: string; draft: string }[],
): string => {
  const sections: string[] = []

  sections.push("## spec.md\n")
  sections.push(specMd)
  sections.push("")

  sections.push("## Specialist Research Reports\n")
  for (const { perspective, draft } of drafts) {
    sections.push(`### ${perspective.charAt(0).toUpperCase() + perspective.slice(1)} Specialist Report\n`)
    sections.push(draft)
    sections.push("\n---\n")
  }

  sections.push("## Output\n")
  sections.push(`Write the synthesized research report to: ${buildDir}/research.md`)
  sections.push("Use the Write tool to create the file.")

  return sections.join("\n")
}

// ---------------------------------------------------------------------------
// Research ensemble
// ---------------------------------------------------------------------------

export type ResearchConfig = {
  model: string
  timeoutMinutes: number
  maxBudgetUsd: number | null
  buildDir: string
  flavour: string | null
  isDeep: boolean
  networkAllowlist: string[]
  sandboxProvider?: import("../../types").RidgelineConfig["sandboxProvider"]
}

export const invokeResearcher = async (
  specMd: string,
  constraintsMd: string,
  tasteMd: string | null,
  config: ResearchConfig,
): Promise<EnsembleResult> => {
  const registry = buildAgentRegistry(resolveFlavour(config.flavour))
  const context = registry.getContext("researchers") ?? ""
  const allSpecialists = registry.getSpecialists("researchers")

  // Quick mode: use only the first specialist (ecosystem by default — most broadly useful)
  // Deep mode: use all specialists
  const specialists = config.isDeep
    ? allSpecialists
    : allSpecialists.length > 0
      ? [allSpecialists[0]]
      : []

  return invokeEnsemble<string>({
    label: "Researching",
    specialists,
    isStructured: false,

    buildSpecialistPrompt: (overlay) => buildResearchSpecialistPrompt(context, overlay),
    specialistUserPrompt: assembleSpecialistUserPrompt(specMd, constraintsMd, tasteMd),
    specialistSchema: "", // unused when isStructured is false
    specialistTools: ["WebFetch", "WebSearch", "Bash"],

    synthesizerPrompt: registry.getCorePrompt("researcher.md"),
    buildSynthesizerUserPrompt: (drafts) =>
      assembleSynthesizerUserPrompt(specMd, config.buildDir, drafts),
    synthesizerTools: ["Write"],

    model: config.model,
    timeoutMinutes: config.timeoutMinutes,
    maxBudgetUsd: config.maxBudgetUsd,
    networkAllowlist: config.networkAllowlist,
    sandboxProvider: config.sandboxProvider,

    verify: () => {
      if (!fs.existsSync(path.join(config.buildDir, "research.md"))) {
        throw new Error("Synthesizer did not create research.md")
      }
    },
  })
}
