import * as fs from "node:fs"
import * as path from "node:path"
import { EnsembleResult } from "../../types"
import { invokeEnsemble, SYNTHESIZER_STALL_TIMEOUT_MS } from "./ensemble.exec"
import { invokeClaude } from "../claude/claude.exec"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { createStderrHandler } from "./pipeline.shared"
import { startSpinner } from "../../ui/spinner"
import { PromptDocument } from "./prompt.document"

// ---------------------------------------------------------------------------
// Shared prompt helpers
// ---------------------------------------------------------------------------

/** Append the common spec + constraints + taste sections to a prompt document. */
const appendInputSections = (doc: PromptDocument, specMd: string, constraintsMd: string, tasteMd: string | null): void => {
  doc.data("spec.md", specMd)
  doc.data("constraints.md", constraintsMd)
  if (tasteMd) {
    doc.data("taste.md", tasteMd)
  }
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
  const doc = new PromptDocument()

  doc.data("spec.md", specMd)

  if (gapsMd) {
    doc.data("Domain Gap Checklist", gapsMd)
  }

  if (existingResearchMd) {
    doc.data("Prior Research (already conducted)", existingResearchMd)
  }

  if (changelogMd) {
    doc.data("Spec Changelog (recommendations already incorporated)", changelogMd)
  }

  doc.instruction("Task", "Produce a focused research agenda identifying gaps and specific questions for specialists to investigate.")

  return doc.render()
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
  const doc = new PromptDocument()
  appendInputSections(doc, specMd, constraintsMd, tasteMd)

  if (agenda) {
    doc.data(
      "Research Agenda",
      "The following gaps and questions were identified. Focus your research on these areas:\n\n" + agenda,
    )
  }

  doc.instruction("Task", "Research this spec thoroughly using your web tools. Produce a markdown research report as your response.")
  return doc.render()
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
  const doc = new PromptDocument()

  doc.data("spec.md", specMd)

  const reportLines: string[] = []
  for (const { perspective, draft } of drafts) {
    reportLines.push(`### ${perspective.charAt(0).toUpperCase() + perspective.slice(1)} Specialist Report\n`)
    reportLines.push(draft)
    reportLines.push("\n---\n")
  }
  doc.data("Specialist Research Reports", reportLines.join("\n"))

  if (existingResearchMd) {
    doc.data("Existing research.md (to be updated, not replaced)", existingResearchMd)
  }

  if (changelogMd) {
    doc.data("spec.changelog.md (recommendations already acted on)", changelogMd)
  }

  doc.data("Current Iteration", `Iteration: ${iterationNumber}`)

  doc.instruction(
    "Output",
    `Write the ${existingResearchMd ? "updated" : "new"} research report to: ${buildDir}/research.md\nUse the Write tool to create the file.`,
  )

  return doc.render()
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
  const registry = buildAgentRegistry()
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
    specialistTools: ["WebFetch", "WebSearch", "Bash", "Skill"],

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
    synthesizerTools: ["Write", "Skill"],

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
