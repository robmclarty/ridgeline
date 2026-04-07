import * as fs from "node:fs"
import * as path from "node:path"
import { SpecifierDraft, EnsembleResult } from "../../types"
import { invokeEnsemble } from "./ensemble.exec"
import { resolveAgentPrompt } from "../claude/agent.prompt"
import { formatProposalHeading } from "./pipeline.shared"

// ---------------------------------------------------------------------------
// JSON schema for structured spec specialist output
// ---------------------------------------------------------------------------

const SPEC_SPECIALIST_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    perspective: { type: "string", description: "The specialist's perspective label" },
    spec: {
      type: "object",
      properties: {
        title: { type: "string" },
        overview: { type: "string" },
        features: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              acceptanceCriteria: { type: "array", items: { type: "string" } },
            },
            required: ["name", "description", "acceptanceCriteria"],
          },
        },
        scopeBoundaries: {
          type: "object",
          properties: {
            inScope: { type: "array", items: { type: "string" } },
            outOfScope: { type: "array", items: { type: "string" } },
          },
          required: ["inScope", "outOfScope"],
        },
      },
      required: ["title", "overview", "features", "scopeBoundaries"],
    },
    constraints: {
      type: "object",
      properties: {
        language: { type: "string" },
        runtime: { type: "string" },
        framework: { type: ["string", "null"] },
        directoryConventions: { type: "string" },
        namingConventions: { type: "string" },
        apiStyle: { type: ["string", "null"] },
        database: { type: ["string", "null"] },
        dependencies: { type: "array", items: { type: "string" } },
        checkCommand: { type: "string" },
      },
      required: ["language", "runtime", "directoryConventions", "namingConventions", "dependencies", "checkCommand"],
    },
    taste: {
      type: ["object", "null"],
      properties: {
        codeStyle: { type: "array", items: { type: "string" } },
        testPatterns: { type: "array", items: { type: "string" } },
        commitFormat: { type: ["string", "null"] },
        commentStyle: { type: ["string", "null"] },
      },
    },
    tradeoffs: { type: "string", description: "What this approach sacrifices" },
    concerns: {
      type: "array",
      items: { type: "string" },
      description: "Things the other specialists might miss",
    },
  },
  required: ["perspective", "spec", "constraints", "tradeoffs", "concerns"],
})

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/** Build a spec specialist system prompt from the overlay + JSON directive. */
const buildSpecSpecialistPrompt = (overlay: string): string => {
  const jsonDirective = [
    "",
    "## Your Task",
    "",
    "Read the shape document below and produce a structured proposal for spec.md, constraints.md, and optionally taste.md.",
    "Return your proposal as a single JSON object.",
    "Do NOT use the Write tool. Do NOT produce markdown. Do NOT write prose or commentary.",
    "Your entire response must be valid JSON matching the provided schema.",
    "",
    "Your JSON must include:",
    "- `perspective`: Your specialist perspective label",
    "- `spec`: { title, overview, features (with name, description, acceptanceCriteria), scopeBoundaries (inScope, outOfScope) }",
    "- `constraints`: { language, runtime, framework, directoryConventions, namingConventions, apiStyle, database, dependencies, checkCommand }",
    "- `taste`: { codeStyle, testPatterns, commitFormat, commentStyle } or null if no style preferences expressed",
    "- `tradeoffs`: What your approach sacrifices",
    "- `concerns`: Things the other specialists might miss",
  ].join("\n")

  return `${overlay}${jsonDirective}`
}

/** Assemble the user prompt for a spec specialist — just the shape content. */
const assembleSpecialistUserPrompt = (shapeMd: string): string => {
  return `## shape.md\n\n${shapeMd}\n\nIMPORTANT: Respond with ONLY a JSON object. No prose, no markdown, no commentary. Just the JSON.`
}

/** Assemble the user prompt for the specifier synthesizer. */
const assembleSynthesizerUserPrompt = (
  shapeMd: string,
  buildDir: string,
  drafts: { perspective: string; draft: SpecifierDraft }[],
): string => {
  const sections: string[] = []

  sections.push("## shape.md\n")
  sections.push(shapeMd)
  sections.push("")

  sections.push("## Specialist Proposals\n")
  for (const { perspective, draft } of drafts) {
    formatProposalHeading(sections, perspective, draft.tradeoffs)
    sections.push(`**Concerns:** ${draft.concerns.join("; ")}\n`)

    sections.push("**Spec Proposal:**")
    sections.push(`- Title: ${draft.spec.title}`)
    sections.push(`- Overview: ${draft.spec.overview}`)
    sections.push(`- Features (${draft.spec.features.length}):`)
    for (const feature of draft.spec.features) {
      sections.push(`  - **${feature.name}**: ${feature.description}`)
      sections.push(`    Criteria: ${feature.acceptanceCriteria.join("; ")}`)
    }
    sections.push(`- In scope: ${draft.spec.scopeBoundaries.inScope.join("; ")}`)
    sections.push(`- Out of scope: ${draft.spec.scopeBoundaries.outOfScope.join("; ")}`)
    sections.push("")

    sections.push("**Constraints Proposal:**")
    sections.push(`- Language: ${draft.constraints.language}, Runtime: ${draft.constraints.runtime}`)
    if (draft.constraints.framework) sections.push(`- Framework: ${draft.constraints.framework}`)
    sections.push(`- Directory: ${draft.constraints.directoryConventions}`)
    sections.push(`- Naming: ${draft.constraints.namingConventions}`)
    if (draft.constraints.apiStyle) sections.push(`- API style: ${draft.constraints.apiStyle}`)
    if (draft.constraints.database) sections.push(`- Database: ${draft.constraints.database}`)
    sections.push(`- Dependencies: ${draft.constraints.dependencies.join(", ")}`)
    sections.push(`- Check command: \`${draft.constraints.checkCommand}\``)
    sections.push("")

    if (draft.taste) {
      sections.push("**Taste Proposal:**")
      if (draft.taste.codeStyle.length > 0) sections.push(`- Code style: ${draft.taste.codeStyle.join("; ")}`)
      if (draft.taste.testPatterns.length > 0) sections.push(`- Test patterns: ${draft.taste.testPatterns.join("; ")}`)
      if (draft.taste.commitFormat) sections.push(`- Commit format: ${draft.taste.commitFormat}`)
      if (draft.taste.commentStyle) sections.push(`- Comment style: ${draft.taste.commentStyle}`)
      sections.push("")
    }

    sections.push("---\n")
  }

  sections.push("## Output Directory\n")
  sections.push(`Write spec.md, constraints.md, and optionally taste.md to: ${buildDir}/`)
  sections.push("Use the Write tool to create each file.")

  return sections.join("\n")
}

// ---------------------------------------------------------------------------
// Spec ensemble — thin wrapper over invokeEnsemble
// ---------------------------------------------------------------------------

export type SpecEnsembleConfig = {
  model: string
  timeoutMinutes: number
  maxBudgetUsd: number | null
  buildDir: string
}

export const invokeSpecifier = async (
  shapeMd: string,
  config: SpecEnsembleConfig,
): Promise<EnsembleResult> => {
  return invokeEnsemble<SpecifierDraft>({
    label: "Specifying",
    agentDir: "specifiers",

    buildSpecialistPrompt: buildSpecSpecialistPrompt,
    specialistUserPrompt: assembleSpecialistUserPrompt(shapeMd),
    specialistSchema: SPEC_SPECIALIST_SCHEMA,

    synthesizerPrompt: resolveAgentPrompt("specifier.md"),
    buildSynthesizerUserPrompt: (drafts) =>
      assembleSynthesizerUserPrompt(shapeMd, config.buildDir, drafts),
    synthesizerTools: ["Write"],

    model: config.model,
    timeoutMinutes: config.timeoutMinutes,
    maxBudgetUsd: config.maxBudgetUsd,

    verify: () => {
      const missing = ["spec.md", "constraints.md"]
        .filter(f => !fs.existsSync(path.join(config.buildDir, f)))
      if (missing.length > 0) {
        throw new Error(`Synthesizer did not create required files: ${missing.join(", ")}`)
      }
    },
  })
}
