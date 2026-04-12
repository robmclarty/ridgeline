import * as fs from "node:fs"
import * as path from "node:path"
import { EnsembleResult } from "../../types"
import { invokeEnsemble, SYNTHESIZER_STALL_TIMEOUT_MS } from "./ensemble.exec"
import { invokeClaude } from "../claude/claude.exec"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { resolveFlavour } from "../discovery/flavour.resolve"
import { createStderrHandler } from "./pipeline.shared"
import { startSpinner } from "../../ui/spinner"

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
// Research agenda
// ---------------------------------------------------------------------------

const AGENDA_SYSTEM_PROMPT = `You are a research agenda planner. Given a specification and a domain gap checklist, identify what the spec is missing or vague about, and produce a focused research agenda.

Your output is a markdown research agenda that will be given to research specialists to focus their web searches. Be specific — name the gaps, suggest search terms, and prioritize by impact.

If prior research findings are provided, note which areas are already well-covered and should not be re-researched unless contradictory information is found. Focus the agenda on unexplored territory.

Keep your response concise — under 500 words. No preamble.`

const buildAgendaUserPrompt = (
  specMd: string,
  gapsMd: string | null,
  existingResearchMd: string | null,
  changelogMd: string | null,
): string => {
  const sections: string[] = []

  sections.push("## spec.md\n")
  sections.push(specMd)
  sections.push("")

  if (gapsMd) {
    sections.push("## Domain Gap Checklist\n")
    sections.push(gapsMd)
    sections.push("")
  }

  if (existingResearchMd) {
    sections.push("## Prior Research (already conducted)\n")
    sections.push(existingResearchMd)
    sections.push("")
  }

  if (changelogMd) {
    sections.push("## Spec Changelog (recommendations already incorporated)\n")
    sections.push(changelogMd)
    sections.push("")
  }

  sections.push("Produce a focused research agenda identifying gaps and specific questions for specialists to investigate.")

  return sections.join("\n")
}

const buildResearchAgenda = async (
  specMd: string,
  gapsMd: string | null,
  existingResearchMd: string | null,
  changelogMd: string | null,
  model: string,
  timeoutMinutes: number,
): Promise<string> => {
  const result = await invokeClaude({
    systemPrompt: AGENDA_SYSTEM_PROMPT,
    userPrompt: buildAgendaUserPrompt(specMd, gapsMd, existingResearchMd, changelogMd),
    model: "sonnet",
    allowedTools: [],
    cwd: process.cwd(),
    timeoutMs: Math.min(timeoutMinutes * 60 * 1000, 3 * 60 * 1000), // cap at 3 min
    onStderr: createStderrHandler("agenda"),
  })

  return (result.result as string) ?? ""
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/** Build a research specialist system prompt from shared context + overlay. */
const buildResearchSpecialistPrompt = (context: string, overlay: string): string => {
  return `${context}\n\n${overlay}`
}

/** Assemble the user prompt for a research specialist. */
const assembleSpecialistUserPrompt = (
  specMd: string,
  constraintsMd: string,
  tasteMd: string | null,
  agenda: string | null,
): string => {
  const sections = assembleInputSections(specMd, constraintsMd, tasteMd)

  if (agenda) {
    sections.push("## Research Agenda\n")
    sections.push("The following gaps and questions were identified. Focus your research on these areas:\n")
    sections.push(agenda)
    sections.push("")
  }

  sections.push("Research this spec thoroughly using your web tools. Produce a markdown research report as your response.")
  return sections.join("\n")
}

/** Assemble the user prompt for the research synthesizer. */
const assembleSynthesizerUserPrompt = (
  specMd: string,
  buildDir: string,
  drafts: { perspective: string; draft: string }[],
  existingResearchMd: string | null,
  changelogMd: string | null,
  iterationNumber: number,
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

  if (existingResearchMd) {
    sections.push("## Existing research.md (to be updated, not replaced)\n")
    sections.push(existingResearchMd)
    sections.push("")
  }

  if (changelogMd) {
    sections.push("## spec.changelog.md (recommendations already acted on)\n")
    sections.push(changelogMd)
    sections.push("")
  }

  sections.push("## Current Iteration\n")
  sections.push(`Iteration: ${iterationNumber}`)
  sections.push("")

  sections.push("## Output\n")
  sections.push(`Write the ${existingResearchMd ? "updated" : "new"} research report to: ${buildDir}/research.md`)
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
  isQuick: boolean
  networkAllowlist: string[]
  sandboxProvider?: import("../../types").RidgelineConfig["sandboxProvider"]
  existingResearchMd: string | null
  changelogMd: string | null
  iterationNumber: number
}

export const invokeResearcher = async (
  specMd: string,
  constraintsMd: string,
  tasteMd: string | null,
  config: ResearchConfig,
): Promise<EnsembleResult> => {
  const registry = buildAgentRegistry(resolveFlavour(config.flavour))
  const context = registry.getContext("researchers") ?? ""
  const gapsMd = registry.getGaps("researchers")
  const allSpecialists = registry.getSpecialists("researchers")

  // Quick mode: pick one specialist at random
  // Default: use all specialists
  const specialists = config.isQuick && allSpecialists.length > 0
    ? [allSpecialists[Math.floor(Math.random() * allSpecialists.length)]]
    : allSpecialists

  // Build a research agenda before dispatching specialists
  const agendaSpinner = startSpinner("Building agenda")
  const agenda = await buildResearchAgenda(
    specMd,
    gapsMd,
    config.existingResearchMd,
    config.changelogMd,
    config.model,
    config.timeoutMinutes,
  )
  agendaSpinner.stop()

  return invokeEnsemble<string>({
    label: "Researching",
    specialists,
    isStructured: false,

    buildSpecialistPrompt: (overlay) => buildResearchSpecialistPrompt(context, overlay),
    specialistUserPrompt: assembleSpecialistUserPrompt(specMd, constraintsMd, tasteMd, agenda || null),
    specialistSchema: "", // unused when isStructured is false
    specialistTools: ["WebFetch", "WebSearch", "Bash"],

    synthesizerPrompt: registry.getCorePrompt("researcher.md"),
    buildSynthesizerUserPrompt: (drafts) =>
      assembleSynthesizerUserPrompt(
        specMd,
        config.buildDir,
        drafts,
        config.existingResearchMd,
        config.changelogMd,
        config.iterationNumber,
      ),
    synthesizerTools: ["Write"],

    model: config.model,
    timeoutMinutes: config.timeoutMinutes,
    maxBudgetUsd: config.maxBudgetUsd,
    networkAllowlist: config.networkAllowlist,
    sandboxProvider: config.sandboxProvider,
    stallTimeoutMs: SYNTHESIZER_STALL_TIMEOUT_MS,

    verify: () => {
      if (!fs.existsSync(path.join(config.buildDir, "research.md"))) {
        throw new Error("Synthesizer did not create research.md")
      }
    },
  })
}
