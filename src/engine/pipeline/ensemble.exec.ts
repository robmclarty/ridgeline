import { RidgelineConfig, PhaseInfo, ClaudeResult, SpecialistProposal, EnsembleResult } from "../../types"
import { invokeClaude } from "../claude/claude.exec"
import { createDisplayCallbacks } from "../claude/stream.display"
import { scanPhases } from "../../stores/phases"
import { printInfo, printError } from "../../ui/output"
import { startSpinner, formatElapsed } from "../../ui/spinner"
import { appendTranscript } from "../../ui/transcript"
import { buildAgentRegistry, SpecialistDef } from "../discovery/agent.registry"
import { appendBaseUserPrompt } from "./plan.exec"
import { createStderrHandler, formatProposalHeading } from "./pipeline.shared"
import { PromptDocument } from "./prompt.document"

// ---------------------------------------------------------------------------
// Robust JSON extraction — handles markdown fences and surrounding text
// ---------------------------------------------------------------------------

/**
 * Attempt to extract a JSON object from a string that may be wrapped in
 * markdown fences (```json ... ```) or surrounded by explanatory text.
 * Returns the parsed object on success, or throws on failure.
 */
export const extractJSON = (raw: string): unknown => {
  const trimmed = raw.trim()

  // 1. Try direct parse first (happy path)
  try {
    return JSON.parse(trimmed)
  } catch {
    // continue to extraction strategies
  }

  // 2. Strip markdown fences: ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim())
    } catch {
      // continue
    }
  }

  // 3. Find the outermost { ... } in the string
  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1))
    } catch {
      // continue
    }
  }

  throw new Error("No valid JSON object found in output")
}

/** Synthesizers may go quiet during large Write calls; allow more headroom than the default 5 min. */
export const SYNTHESIZER_STALL_TIMEOUT_MS = 8 * 60 * 1000

// ---------------------------------------------------------------------------
// Generic ensemble runner
// ---------------------------------------------------------------------------

type EnsembleConfig<TDraft> = {
  /** Human label for spinner and error messages, e.g., "Planning" or "Specifying" */
  label: string

  /** Pre-resolved specialists from the agent registry */
  specialists: SpecialistDef[]

  /** Build the system prompt for a specialist given their overlay text */
  buildSpecialistPrompt: (overlay: string) => string

  /** The user prompt sent to each specialist */
  specialistUserPrompt: string

  /** JSON schema string for structured specialist output. Ignored when isStructured is false. */
  specialistSchema: string

  /**
   * When true (default), specialists output structured JSON parsed via specialistSchema.
   * When false, specialists output free-form prose returned as-is in TDraft (expects TDraft = string).
   */
  isStructured?: boolean

  /** Pre-resolved synthesizer system prompt content */
  synthesizerPrompt: string

  /** Build the synthesizer user prompt from successful drafts */
  buildSynthesizerUserPrompt: (
    drafts: { perspective: string; draft: TDraft }[]
  ) => string

  /** Allowed tools for the synthesizer invocation */
  synthesizerTools: string[]

  /** Allowed tools for specialist invocations (default: none) */
  specialistTools?: string[]

  /** Model name for invokeClaude */
  model: string

  /** Timeout in minutes */
  timeoutMinutes: number

  /** Budget cap (null = unlimited) */
  maxBudgetUsd: number | null

  /** Optional post-synthesis verification. Throw to signal failure. */
  verify?: () => void

  /** Network allowlist for specialist invocations (e.g., research needs web access) */
  networkAllowlist?: string[]

  /** Sandbox provider for specialist invocations */
  sandboxProvider?: import("../../types").RidgelineConfig["sandboxProvider"]

  /** Stall timeout override for the synthesizer invocation (ms). */
  stallTimeoutMs?: number

  /**
   * Enable two-round ensemble: after round 1 (independent drafts), each specialist
   * sees all other drafts and produces annotations (concerns, agreements, gaps).
   * The synthesizer then receives both drafts and annotations.
   * Default: false (opt-in, because it roughly doubles specialist cost).
   */
  isTwoRound?: boolean

  /** Build the annotation prompt for round 2, given other drafts. Requires isTwoRound. */
  buildAnnotationPrompt?: (
    ownPerspective: string,
    otherDrafts: { perspective: string; draft: TDraft }[],
  ) => string
}

type AnnotationEntry = { perspective: string; annotation: string; result: ClaudeResult }

/** Run the optional two-round annotation pass where specialists review each other's drafts. */
const runAnnotationPass = async <TDraft>(
  config: EnsembleConfig<TDraft>,
  successful: { perspective: string; result: ClaudeResult; draft: TDraft }[],
): Promise<AnnotationEntry[]> => {
  if (!config.isTwoRound || !config.buildAnnotationPrompt || successful.length < 2) {
    return []
  }

  printInfo("Round 2: cross-specialist annotations...")
  const annotationSpinner = startSpinner("Annotating")

  const annotationPromises = successful.map(({ perspective }) => {
    const otherDrafts = successful
      .filter((s) => s.perspective !== perspective)
      .map((s) => ({ perspective: s.perspective, draft: s.draft }))

    const annotationPrompt = config.buildAnnotationPrompt!(perspective, otherDrafts)
    const startTime = Date.now()

    return invokeClaude({
      systemPrompt: config.buildSpecialistPrompt(""),
      userPrompt: annotationPrompt,
      model: config.model,
      allowedTools: [],
      cwd: process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      onStderr: createStderrHandler(`${perspective}-annotate`),
    }).then((result) => {
      const elapsed = formatElapsed(Date.now() - startTime)
      const line = `  ${perspective.padEnd(14)} annotated (${elapsed}, $${result.costUsd.toFixed(2)})`
      annotationSpinner.printAbove(line)
      appendTranscript(line)
      return { perspective, annotation: result.result, result }
    })
  })

  const annotationSettled = await Promise.allSettled(annotationPromises)
  annotationSpinner.stop()

  const annotations: AnnotationEntry[] = []
  for (const outcome of annotationSettled) {
    if (outcome.status === "fulfilled") {
      annotations.push(outcome.value)
    } else {
      printError(`Annotation failed: ${outcome.reason}`)
    }
  }

  if (annotations.length > 0) {
    printInfo(`Collected ${annotations.length} annotations`)
  }

  return annotations
}

/** Build the synthesizer user prompt, appending annotations if present. */
const buildSynthPrompt = <TDraft>(
  config: EnsembleConfig<TDraft>,
  successful: { perspective: string; draft: TDraft }[],
  annotations: AnnotationEntry[],
): string => {
  let prompt = config.buildSynthesizerUserPrompt(successful)
  if (annotations.length > 0) {
    const sections = ["\n## Cross-Specialist Annotations\n"]
    sections.push("Each specialist reviewed the other proposals and provided these observations:\n")
    for (const { perspective, annotation } of annotations) {
      sections.push(`### ${perspective}\n`)
      sections.push(annotation)
      sections.push("")
    }
    prompt += sections.join("\n")
  }
  return prompt
}

export const invokeEnsemble = async <TDraft>(
  config: EnsembleConfig<TDraft>
): Promise<EnsembleResult> => {
  // 1. Validate pre-resolved specialists
  const specialists = config.specialists
  if (specialists.length === 0) {
    throw new Error(`No specialist agents found for ${config.label}`)
  }

  // 2. Spawn specialists in parallel
  const spinner = startSpinner(config.label)

  const specialistPromises = specialists.map(({ perspective, overlay }) => {
    const systemPrompt = config.buildSpecialistPrompt(overlay)
    const startTime = Date.now()
    const isStructured = config.isStructured !== false

    return invokeClaude({
      systemPrompt,
      userPrompt: config.specialistUserPrompt,
      model: config.model,
      allowedTools: config.specialistTools ?? [],
      cwd: process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      jsonSchema: isStructured ? config.specialistSchema : undefined,
      onStderr: createStderrHandler(perspective),
      networkAllowlist: config.networkAllowlist,
      sandboxProvider: config.sandboxProvider,
    }).then((result) => {
      const elapsed = formatElapsed(Date.now() - startTime)
      const line = `  ${perspective.padEnd(14)} complete (${elapsed}, $${result.costUsd.toFixed(2)})`
      spinner.printAbove(line)
      appendTranscript(line)
      return { perspective, result }
    })
  })

  const settled = await Promise.allSettled(specialistPromises)

  // 3. Collect successful proposals
  const successful: { perspective: string; result: ClaudeResult; draft: TDraft }[] = []
  const isStructured = config.isStructured !== false

  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      const { perspective, result } = outcome.value
      if (isStructured) {
        try {
          const draft = extractJSON(result.result) as TDraft
          successful.push({ perspective, result, draft })
        } catch {
          const preview = result.result.length > 300
            ? result.result.slice(0, 300) + "..."
            : result.result
          printError(`Failed to parse ${perspective} specialist output as JSON. Preview:\n${preview}`)
        }
      } else {
        successful.push({ perspective, result, draft: result.result as TDraft })
      }
    } else {
      printError(`Specialist failed: ${outcome.reason}`)
    }
  }

  // 4. Threshold check
  const minRequired = Math.ceil(specialists.length / 2)
  if (successful.length < minRequired) {
    spinner.stop()
    throw new Error(
      `${config.label} requires at least ${minRequired} of ${specialists.length} specialist proposals to succeed, got ${successful.length}. ` +
      "Check Claude authentication and try again."
    )
  }

  if (successful.length < specialists.length) {
    printInfo(`Continuing with ${successful.length} of ${specialists.length} proposals`)
  }

  // 5. Two-round annotation pass (optional)
  const annotations = await runAnnotationPass(config, successful)

  // 6. Budget guard
  const specialistCost = successful.reduce((sum, s) => sum + s.result.costUsd, 0)
  const annotationCost = annotations.reduce((sum, a) => sum + a.result.costUsd, 0)
  const preSynthCost = specialistCost + annotationCost
  if (config.maxBudgetUsd !== null && preSynthCost >= config.maxBudgetUsd) {
    spinner.stop()
    throw new Error(
      `Pre-synthesis cost ($${preSynthCost.toFixed(2)}) already exceeds budget ($${config.maxBudgetUsd.toFixed(2)}). ` +
      "Skipping synthesis to avoid further cost."
    )
  }

  // 7. Synthesize
  spinner.stop()
  printInfo("Synthesizing from specialist proposals...")

  const { onStdout, flush } = createDisplayCallbacks({ projectRoot: process.cwd(), dimText: true })
  const synthUserPrompt = buildSynthPrompt(
    config,
    successful.map(({ perspective, draft }) => ({ perspective, draft })),
    annotations,
  )

  let synthResult: ClaudeResult
  try {
    synthResult = await invokeClaude({
      systemPrompt: config.synthesizerPrompt,
      userPrompt: synthUserPrompt,
      model: config.model,
      allowedTools: config.synthesizerTools,
      cwd: process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      stallTimeoutMs: config.stallTimeoutMs,
      onStdout,
      onStderr: createStderrHandler("synthesizer"),
    })
  } finally {
    flush()
  }

  // 8. Post-synthesis verification
  if (config.verify) {
    config.verify()
  }

  // 9. Aggregate results
  const specialistResults = successful.map((s) => s.result)
  const annotationResults = annotations.map((a) => a.result)
  const totalCostUsd = preSynthCost + synthResult.costUsd
  const specialistWallMs = Math.max(...specialistResults.map((r) => r.durationMs))
  const annotationWallMs = annotationResults.length > 0 ? Math.max(...annotationResults.map((r) => r.durationMs)) : 0
  const totalDurationMs = specialistWallMs + annotationWallMs + synthResult.durationMs

  return {
    specialistNames: successful.map((s) => s.perspective),
    specialistResults,
    ...(annotationResults.length > 0 ? { annotationResults } : {}),
    synthesizerResult: synthResult,
    totalCostUsd,
    totalDurationMs,
  }
}

// ---------------------------------------------------------------------------
// Planner ensemble — thin wrapper over invokeEnsemble
// ---------------------------------------------------------------------------

const SPECIALIST_PROPOSAL_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    perspective: { type: "string", description: "The specialist's perspective label" },
    summary: { type: "string", description: "1-2 sentence overview of the approach" },
    phases: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          slug: { type: "string", description: "Kebab-case slug for file naming" },
          goal: { type: "string", description: "1-3 paragraphs in business/product terms" },
          acceptanceCriteria: {
            type: "array",
            items: { type: "string" },
            description: "Concrete, verifiable outcomes",
          },
          specReference: { type: "string", description: "Relevant spec sections" },
          rationale: { type: "string", description: "Why this phase boundary exists" },
          dependsOn: {
            type: "array",
            items: { type: "string" },
            description: "Phase IDs (e.g., '01-scaffold') this phase depends on. Omit or empty for sequential dependency on the previous phase.",
          },
        },
        required: ["title", "slug", "goal", "acceptanceCriteria", "specReference", "rationale"],
      },
    },
    tradeoffs: { type: "string", description: "What this approach sacrifices" },
  },
  required: ["perspective", "summary", "phases", "tradeoffs"],
})

/**
 * Build a planner specialist system prompt by concatenating shared context,
 * the specialist's personality overlay, and a JSON output directive.
 */
const buildPlannerSpecialistPrompt = (context: string, overlay: string): string => {
  const jsonDirective = [
    "",
    "## Your Task",
    "",
    "Decompose the spec into sequential phases. Return your plan as a single JSON object.",
    "Do NOT use the Write tool. Do NOT produce markdown. Do NOT write prose or commentary.",
    "Your entire response must be valid JSON matching the provided schema.",
    "",
    "Each phase in your JSON must include:",
    "- `title`: Phase name",
    "- `slug`: Kebab-case identifier for file naming",
    "- `goal`: 1-3 paragraphs describing what this phase accomplishes (business/product terms, no implementation details)",
    "- `acceptanceCriteria`: Array of concrete, verifiable outcomes",
    "- `specReference`: Relevant spec sections",
    "- `rationale`: Why this phase boundary exists",
    "",
    "Also include your `perspective` label, a `summary` of your approach, and the `tradeoffs` of your plan.",
  ].join("\n")

  return `${context}\n\n${overlay}${jsonDirective}`
}

/** Assemble the user prompt for a planner specialist (no output directory). */
const assemblePlannerSpecialistUserPrompt = (config: RidgelineConfig): string => {
  const doc = new PromptDocument()
  appendBaseUserPrompt(doc, config)
  doc.instruction("Output Format", "IMPORTANT: Respond with ONLY a JSON object. No prose, no markdown, no commentary. Just the JSON.")
  return doc.render()
}

/** Assemble the user prompt for the planner synthesizer, including all proposals. */
const assemblePlannerSynthesizerUserPrompt = (
  config: RidgelineConfig,
  drafts: { perspective: string; draft: SpecialistProposal }[],
): string => {
  const doc = new PromptDocument()

  // Include original inputs
  appendBaseUserPrompt(doc, config)

  // Include each specialist proposal
  const proposalLines: string[] = []
  for (const { perspective, draft } of drafts) {
    formatProposalHeading(proposalLines, perspective, draft.tradeoffs)
    proposalLines.push(`**Summary:** ${draft.summary}\n`)
    proposalLines.push(`**Phases (${draft.phases.length}):**\n`)
    for (let i = 0; i < draft.phases.length; i++) {
      const phase = draft.phases[i]
      proposalLines.push(`#### Phase ${i + 1}: ${phase.title} (\`${phase.slug}\`)`)
      proposalLines.push(`**Goal:** ${phase.goal}\n`)
      proposalLines.push("**Acceptance Criteria:**")
      for (const criterion of phase.acceptanceCriteria) {
        proposalLines.push(`- ${criterion}`)
      }
      proposalLines.push(`\n**Spec Reference:** ${phase.specReference}`)
      proposalLines.push(`**Rationale:** ${phase.rationale}\n`)
    }
    proposalLines.push("---\n")
  }
  doc.data("Specialist Proposals", proposalLines.join("\n"))

  // Output directory
  doc.instruction(
    "Output Directory",
    `Write phase spec files to: ${config.phasesDir}\nUse the naming convention: 01-<slug>.md, 02-<slug>.md, etc.`,
  )

  return doc.render()
}

export const invokePlanner = async (
  config: RidgelineConfig
): Promise<{ result: ClaudeResult; phases: PhaseInfo[]; ensemble: EnsembleResult }> => {
  const registry = buildAgentRegistry()
  const context = registry.getContext("planners") ?? ""

  const ensemble = await invokeEnsemble<SpecialistProposal>({
    label: "Planning",
    specialists: registry.getSpecialists("planners"),

    buildSpecialistPrompt: (overlay) => buildPlannerSpecialistPrompt(context, overlay),
    specialistUserPrompt: assemblePlannerSpecialistUserPrompt(config),
    specialistSchema: SPECIALIST_PROPOSAL_SCHEMA,

    synthesizerPrompt: registry.getCorePrompt("planner.md"),
    buildSynthesizerUserPrompt: (drafts) =>
      assemblePlannerSynthesizerUserPrompt(config, drafts),
    synthesizerTools: ["Write", "Skill"],

    model: config.model,
    timeoutMinutes: config.timeoutMinutes,
    maxBudgetUsd: config.maxBudgetUsd,
    stallTimeoutMs: SYNTHESIZER_STALL_TIMEOUT_MS,

    isTwoRound: config.isDeepEnsemble,
    buildAnnotationPrompt: (ownPerspective, otherDrafts) => {
      const sections = [
        `You are the ${ownPerspective} specialist. You have already submitted your proposal.`,
        "Below are the other specialists' proposals. Review them and provide brief annotations:",
        "- **Concerns:** Issues or risks you see in their approaches",
        "- **Agreements:** Where their proposals align with or strengthen yours",
        "- **Gaps:** What none of the proposals (including yours) adequately address",
        "",
        "Do NOT rewrite your proposal. Provide only annotations.",
        "",
      ]
      for (const { perspective, draft } of otherDrafts) {
        sections.push(`## ${perspective} Specialist Proposal\n`)
        sections.push(`**Summary:** ${draft.summary}`)
        sections.push(`**Phases:** ${draft.phases.length}`)
        sections.push(`**Tradeoffs:** ${draft.tradeoffs}\n`)
      }
      return sections.join("\n")
    },

    verify: () => {
      if (scanPhases(config.phasesDir).length === 0) {
        throw new Error("Synthesizer did not generate any phase files")
      }
    },
  })

  const phases = scanPhases(config.phasesDir)

  return {
    result: ensemble.synthesizerResult,
    phases,
    ensemble,
  }
}
