import * as fs from "node:fs"
import * as path from "node:path"
import { SpecifierDraft, EnsembleResult } from "../../types.js"
import { invokeEnsemble, selectSpecialists, appendSkipAuditNote, SYNTHESIZER_STALL_TIMEOUT_MS } from "./ensemble.exec.js"
import { buildAgentRegistry } from "../discovery/agent.registry.js"
import { formatProposalHeading } from "./pipeline.shared.js"
import { createPromptDocument } from "./prompt.document.js"

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
    _skeleton: {
      type: "object",
      description: "Compact agreement-detection skeleton used to decide whether synthesis can be skipped.",
      properties: {
        sectionOutline: {
          type: "array",
          items: { type: "string" },
          description: "Ordered feature/section names that structure the spec.",
        },
        riskList: {
          type: "array",
          items: { type: "string" },
          description: "Concerns and risks the synthesizer must address.",
        },
      },
      required: ["sectionOutline", "riskList"],
    },
  },
  required: ["perspective", "spec", "constraints", "tradeoffs", "concerns", "_skeleton"],
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
    "- `_skeleton`: { sectionOutline: string[], riskList: string[] } — sectionOutline mirrors your feature/section names in order; riskList mirrors your concerns. Keep this faithful; it is used for ensemble agreement detection.",
  ].join("\n")

  return `${overlay}${jsonDirective}`
}

/** Assemble the user prompt for a spec specialist — shape content plus design context. */
const assembleSpecialistUserPrompt = (
  shapeMd: string,
  config: SpecEnsembleConfig,
): string => {
  const doc = createPromptDocument()

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

const SPEC_GAP_FLAGGING_INSTRUCTION = [
  "When writing each output file, append a final section titled `## Inferred / Gaps`.",
  "Under that heading list every load-bearing fact in the file you inferred without the user's input or shape.md directly stating it.",
  "Use one bullet per item: `- <fact> — inferred because: <one-line reason>`.",
  "If every load-bearing fact is source-backed, write `(none)`.",
  "The user will edit this section to confirm or override your guesses before plan runs.",
].join(" ")

/** Assemble the user prompt for the specifier synthesizer. */
const assembleSynthesizerUserPrompt = (
  shapeMd: string,
  buildDir: string,
  drafts: { perspective: string; draft: SpecifierDraft }[],
  userInput: string | null,
  inferGapFlagging: boolean,
): string => {
  const doc = createPromptDocument()

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

  if (inferGapFlagging) {
    doc.instruction("Gap Flagging", SPEC_GAP_FLAGGING_INSTRUCTION)
  }

  return doc.render()
}

// ---------------------------------------------------------------------------
// Spec ensemble — thin wrapper over invokeEnsemble
// ---------------------------------------------------------------------------

export type SpecEnsembleConfig = {
  model: string
  timeoutMinutes: number
  specialistTimeoutSeconds: number
  maxBudgetUsd: number | null
  buildDir: string
  matchedShapes: string[]
  specialistCount: 1 | 2 | 3
  /** Optional user-authored spec content treated as authoritative source material. */
  userInput: string | null
  /**
   * When true, instruct the synthesizer to append a `## Inferred / Gaps`
   * section to each output file listing facts it had to guess at. Used by
   * the `ingest` command so users can see what to confirm or override.
   */
  inferGapFlagging?: boolean
}

const renderSpecMdFromDraft = (draft: SpecifierDraft): string => {
  const lines: string[] = []
  lines.push(`# ${draft.spec.title}`)
  lines.push("")
  lines.push("## Overview")
  lines.push("")
  lines.push(draft.spec.overview.trim())
  lines.push("")
  lines.push("## Features")
  lines.push("")
  for (const feature of draft.spec.features) {
    lines.push(`### ${feature.name}`)
    lines.push("")
    lines.push(feature.description.trim())
    lines.push("")
    lines.push("**Acceptance Criteria:**")
    lines.push("")
    for (const criterion of feature.acceptanceCriteria) {
      lines.push(`- ${criterion}`)
    }
    lines.push("")
  }
  lines.push("## Scope")
  lines.push("")
  lines.push("**In scope:**")
  lines.push("")
  for (const item of draft.spec.scopeBoundaries.inScope) {
    lines.push(`- ${item}`)
  }
  lines.push("")
  lines.push("**Out of scope:**")
  lines.push("")
  for (const item of draft.spec.scopeBoundaries.outOfScope) {
    lines.push(`- ${item}`)
  }
  lines.push("")
  return lines.join("\n")
}

const renderConstraintsMdFromDraft = (draft: SpecifierDraft): string => {
  const lines: string[] = []
  lines.push("# Constraints")
  lines.push("")
  lines.push(`- **Language:** ${draft.constraints.language}`)
  lines.push(`- **Runtime:** ${draft.constraints.runtime}`)
  if (draft.constraints.framework) lines.push(`- **Framework:** ${draft.constraints.framework}`)
  lines.push(`- **Directory conventions:** ${draft.constraints.directoryConventions}`)
  lines.push(`- **Naming conventions:** ${draft.constraints.namingConventions}`)
  if (draft.constraints.apiStyle) lines.push(`- **API style:** ${draft.constraints.apiStyle}`)
  if (draft.constraints.database) lines.push(`- **Database:** ${draft.constraints.database}`)
  if (draft.constraints.dependencies.length > 0) {
    lines.push(`- **Dependencies:** ${draft.constraints.dependencies.join(", ")}`)
  }
  lines.push("")
  lines.push("## Check Command")
  lines.push("")
  lines.push("```bash")
  lines.push(draft.constraints.checkCommand.trim())
  lines.push("```")
  lines.push("")
  return lines.join("\n")
}

const renderTasteMdFromDraft = (draft: SpecifierDraft): string | null => {
  if (!draft.taste) return null
  const lines: string[] = ["# Taste", ""]
  if (draft.taste.codeStyle.length > 0) {
    lines.push("## Code Style", "")
    for (const item of draft.taste.codeStyle) lines.push(`- ${item}`)
    lines.push("")
  }
  if (draft.taste.testPatterns.length > 0) {
    lines.push("## Test Patterns", "")
    for (const item of draft.taste.testPatterns) lines.push(`- ${item}`)
    lines.push("")
  }
  if (draft.taste.commitFormat) {
    lines.push("## Commit Format", "", draft.taste.commitFormat.trim(), "")
  }
  if (draft.taste.commentStyle) {
    lines.push("## Comment Style", "", draft.taste.commentStyle.trim(), "")
  }
  return lines.join("\n")
}

const writeSpecArtifactsFromDraft = (buildDir: string, draft: SpecifierDraft): string => {
  fs.mkdirSync(buildDir, { recursive: true })
  const specPath = path.join(buildDir, "spec.md")
  fs.writeFileSync(specPath, renderSpecMdFromDraft(draft))
  fs.writeFileSync(path.join(buildDir, "constraints.md"), renderConstraintsMdFromDraft(draft))
  const tasteMd = renderTasteMdFromDraft(draft)
  if (tasteMd) fs.writeFileSync(path.join(buildDir, "taste.md"), tasteMd)
  return specPath
}

export const invokeSpecifier = async (
  shapeMd: string,
  config: SpecEnsembleConfig,
): Promise<EnsembleResult> => {
  const registry = buildAgentRegistry()

  // Get standard specialists, capped at 2 (default) / 3 (thorough).
  const baseSpecialists = registry.getSpecialists("specifiers")
  let specialists = selectSpecialists(baseSpecialists, { specialistCount: config.specialistCount })

  // Conditionally add visual coherence specialist when visual shapes matched.
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
      assembleSynthesizerUserPrompt(
        shapeMd,
        config.buildDir,
        drafts,
        config.userInput,
        config.inferGapFlagging ?? false,
      ),
    synthesizerTools: ["Write"],

    model: config.model,
    timeoutMinutes: config.timeoutMinutes,
    specialistTimeoutSeconds: config.specialistTimeoutSeconds,
    maxBudgetUsd: config.maxBudgetUsd,
    stallTimeoutMs: SYNTHESIZER_STALL_TIMEOUT_MS,

    isTwoRound: config.specialistCount === 3,
    buildAnnotationPrompt: (ownPerspective, otherDrafts) => {
      const sections = [
        `You are the ${ownPerspective} specialist. You have already submitted your proposal.`,
        "Below are the other specialists' proposals. Review them and provide brief annotations:",
        "- **Concerns:** Issues you see in their approaches",
        "- **Agreements:** Where they align with or strengthen yours",
        "- **Gaps:** What none of the proposals (including yours) adequately address",
        "",
        "Do NOT rewrite your proposal. Provide only annotations.",
        "",
      ]
      for (const { perspective, draft } of otherDrafts) {
        sections.push(`## ${perspective} Specialist Proposal\n`)
        sections.push(`**Summary:** ${draft.spec.overview}`)
        sections.push(`**Features:** ${draft.spec.features.length}`)
        sections.push(`**Tradeoffs:** ${draft.tradeoffs}\n`)
      }
      return sections.join("\n")
    },

    stage: "spec",
    buildDir: config.buildDir,
    // Skip the agreement shortcut when gap-flagging is requested: the
    // shortcut writes files mechanically from a specialist draft, bypassing
    // the synthesizer prompt where the gap directive lives.
    onAgreementSkip: config.inferGapFlagging ? undefined : (successful) => {
      const [first] = successful
      const specPath = writeSpecArtifactsFromDraft(config.buildDir, first.draft)
      appendSkipAuditNote(specPath, successful.length, "spec")
      return {
        success: true,
        result: JSON.stringify(first.draft),
        durationMs: 0,
        costUsd: 0,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        sessionId: `synthesis-skipped-${first.perspective}`,
      }
    },

    verify: () => {
      const missing = ["spec.md", "constraints.md"]
        .filter((f) => !fs.existsSync(path.join(config.buildDir, f)))
      if (missing.length > 0) {
        throw new Error(`Synthesizer did not create required files: ${missing.join(", ")}`)
      }
    },
  })
}
