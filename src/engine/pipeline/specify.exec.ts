import * as fs from "node:fs"
import * as path from "node:path"
import { SpecifierDraft, EnsembleResult } from "../../types"
import { invokeEnsemble, SYNTHESIZER_STALL_TIMEOUT_MS } from "./ensemble.exec"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { formatProposalHeading } from "./pipeline.shared"
import { PromptDocument } from "./prompt.document"

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
    design: {
      type: ["object", "null"],
      properties: {
        hardTokens: { type: "array", items: { type: "string" } },
        softGuidance: { type: "array", items: { type: "string" } },
        featureVisuals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              feature: { type: "string" },
              criteria: { type: "array", items: { type: "string" } },
            },
            required: ["feature", "criteria"],
          },
        },
      },
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

/** Assemble the user prompt for a spec specialist — shape content plus design context. */
const assembleSpecialistUserPrompt = (
  shapeMd: string,
  config: SpecEnsembleConfig,
): string => {
  const doc = new PromptDocument()

  doc.data("shape.md", shapeMd)

  if (config.userInput) {
    doc.data("User-Provided Spec Draft", config.userInput)
    doc.instruction(
      "Authority of User Input",
      [
        "The user has provided an existing spec draft (above) as authoritative source material.",
        "Treat its content as higher priority than your own defaults: preserve its detail, features, acceptance criteria, constraints, and taste preferences where they do not directly contradict shape.md.",
        "Your job is to sharpen, enrich, and fill gaps — not to replace the user's draft with a rewrite.",
        "If a detail in the user draft conflicts with shape.md, note the conflict in `concerns` and defer to shape.md's declared scope.",
      ].join(" "),
    )
  }

  // Inject design.md for visual specialist context
  const ridgelineDir = path.join(config.buildDir, "..", "..")
  const projectDesignPath = path.join(ridgelineDir, "design.md")
  const featureDesignPath = path.join(config.buildDir, "design.md")

  if (fs.existsSync(projectDesignPath)) {
    doc.data("Project Design", fs.readFileSync(projectDesignPath, "utf-8"))
  }

  if (fs.existsSync(featureDesignPath)) {
    doc.data("Feature Design", fs.readFileSync(featureDesignPath, "utf-8"))
  }

  if (config.matchedShapes.length > 0) {
    doc.data("Matched Visual Shape Categories", config.matchedShapes.join(", "))
  }

  doc.instruction("Output Format", "IMPORTANT: Respond with ONLY a JSON object. No prose, no markdown, no commentary. Just the JSON.")

  return doc.render()
}

/** Format a single specialist draft into prompt sections. */
const formatDraftProposal = (
  sections: string[],
  perspective: string,
  draft: SpecifierDraft,
): void => {
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

  if (draft.design) {
    sections.push("**Design Proposal:**")
    if (draft.design.hardTokens && draft.design.hardTokens.length > 0) {
      sections.push(`- Hard tokens: ${draft.design.hardTokens.join("; ")}`)
    }
    if (draft.design.softGuidance && draft.design.softGuidance.length > 0) {
      sections.push(`- Soft guidance: ${draft.design.softGuidance.join("; ")}`)
    }
    if (draft.design.featureVisuals && draft.design.featureVisuals.length > 0) {
      sections.push("- Feature visuals:")
      for (const fv of draft.design.featureVisuals) {
        sections.push(`  - **${fv.feature}**: ${fv.criteria.join("; ")}`)
      }
    }
    sections.push("")
  }

  sections.push("---\n")
}

/** Assemble the user prompt for the specifier synthesizer. */
const assembleSynthesizerUserPrompt = (
  shapeMd: string,
  buildDir: string,
  drafts: { perspective: string; draft: SpecifierDraft }[],
  userInput: string | null,
): string => {
  const doc = new PromptDocument()

  doc.data("shape.md", shapeMd)

  if (userInput) {
    doc.data("User-Provided Spec Draft", userInput)
    doc.instruction(
      "Authority of User Input",
      [
        "The user has provided an existing spec draft (above) as authoritative source material.",
        "Treat it as higher priority than the specialist proposals: preserve the user's detail, features, acceptance criteria, constraints, and taste preferences wherever they do not contradict shape.md.",
        "Use the specialist proposals to sharpen, enrich, and fill gaps — do not replace the user's draft with a rewrite.",
        "If specialists and the user draft disagree on a non-conflicting detail, favor the user draft.",
      ].join(" "),
    )
  }

  const proposalLines: string[] = []
  for (const { perspective, draft } of drafts) {
    formatDraftProposal(proposalLines, perspective, draft)
  }
  doc.data("Specialist Proposals", proposalLines.join("\n"))

  doc.instruction(
    "Output Directory",
    `Write spec.md, constraints.md, and optionally taste.md to: ${buildDir}/\nUse the Write tool to create each file.`,
  )

  return doc.render()
}

// ---------------------------------------------------------------------------
// Spec ensemble — thin wrapper over invokeEnsemble
// ---------------------------------------------------------------------------

export type SpecEnsembleConfig = {
  model: string
  timeoutMinutes: number
  maxBudgetUsd: number | null
  buildDir: string
  flavour: string | null
  matchedShapes: string[]
  /** Optional user-authored spec content treated as authoritative source material. */
  userInput: string | null
}

export const invokeSpecifier = async (
  shapeMd: string,
  config: SpecEnsembleConfig,
): Promise<EnsembleResult> => {
  const registry = buildAgentRegistry()

  // Get standard specialists
  let specialists = registry.getSpecialists("specifiers")

  // Conditionally add visual coherence specialist when visual shapes matched
  if (config.matchedShapes.length > 0) {
    const visualSpecialist = registry.getSpecialist("specifiers", "visual-coherence.md")
    if (visualSpecialist) {
      specialists = [...specialists, visualSpecialist]
    }
  }

  return invokeEnsemble<SpecifierDraft>({
    label: "Specifying",
    specialists,

    buildSpecialistPrompt: buildSpecSpecialistPrompt,
    specialistUserPrompt: assembleSpecialistUserPrompt(shapeMd, config),
    specialistSchema: SPEC_SPECIALIST_SCHEMA,

    synthesizerPrompt: registry.getCorePrompt("specifier.md"),
    buildSynthesizerUserPrompt: (drafts) =>
      assembleSynthesizerUserPrompt(shapeMd, config.buildDir, drafts, config.userInput),
    synthesizerTools: ["Write"],

    model: config.model,
    timeoutMinutes: config.timeoutMinutes,
    maxBudgetUsd: config.maxBudgetUsd,
    stallTimeoutMs: SYNTHESIZER_STALL_TIMEOUT_MS,

    verify: () => {
      const missing = ["spec.md", "constraints.md"]
        .filter(f => !fs.existsSync(path.join(config.buildDir, f)))
      if (missing.length > 0) {
        throw new Error(`Synthesizer did not create required files: ${missing.join(", ")}`)
      }
    },
  })
}
