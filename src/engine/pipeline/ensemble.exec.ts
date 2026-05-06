import * as fs from "node:fs"
import { RidgelineConfig, PhaseInfo, ClaudeResult, SpecialistProposal, EnsembleResult, SpecialistStage, SpecialistVerdict } from "../../types"
import { invokeClaude } from "../claude/claude.exec"
import { createDisplayCallbacks } from "../claude/stream.display"
import { scanPhases } from "../../stores/phases"
import { printInfo, printError, printWarn } from "../../ui/output"
import { startSpinner, formatElapsed } from "../../ui/spinner"
import { appendTranscript } from "../../ui/transcript"
import { buildAgentRegistry, SpecialistDef } from "../discovery/agent.registry"
import { appendBaseUserPrompt } from "./plan.exec"
import { createStderrHandler, formatProposalHeading } from "./pipeline.shared"
import { createPromptDocument } from "./prompt.document"
import { logTrajectory } from "../../stores/trajectory"
import { DEFAULT_SPECIALIST_TIMEOUT_SECONDS } from "../../stores/settings"
import { parseSpecialistVerdict, skeletonsAgree } from "./specialist.verdict"

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

  try {
    return JSON.parse(trimmed)
  } catch {
    // continue
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim())
    } catch {
      // continue
    }
  }

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

  /** Synthesizer timeout in minutes. */
  timeoutMinutes: number

  /**
   * Per-specialist call timeout in seconds. Defaults to 600. When `isStructured`
   * is false (research), caller may override with a longer value.
   */
  specialistTimeoutSeconds?: number

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
   */
  isTwoRound?: boolean

  /** Build the annotation prompt for round 2, given other drafts. Requires isTwoRound. */
  buildAnnotationPrompt?: (
    ownPerspective: string,
    otherDrafts: { perspective: string; draft: TDraft }[],
  ) => string

  /** Stage identifier for structured-verdict agreement detection. */
  stage?: SpecialistStage

  /**
   * Build directory used for trajectory logging. When absent, specialist
   * failures and agreement skips are logged to stderr only.
   */
  buildDir?: string

  /**
   * Extract the raw string used for skeleton parsing from a specialist's draft.
   * Defaults to the ClaudeResult.result text.
   */
  skeletonSource?: (result: ClaudeResult, draft: TDraft) => string

  /**
   * When all specialists' skeletons agree, produce the canonical artifact
   * from the first specialist's draft and return a synthetic synthesizer
   * result describing the skip. When absent, agreement detection is disabled.
   */
  onAgreementSkip?: (
    successful: { perspective: string; result: ClaudeResult; draft: TDraft }[],
  ) => Promise<ClaudeResult> | ClaudeResult
}

type AnnotationEntry = { perspective: string; annotation: string; result: ClaudeResult }

const isTimeoutMessage = (msg: string): boolean => {
  const lower = msg.toLowerCase()
  return lower.includes("timed out") || lower.includes("timeout") || lower.includes("stall")
}

const logSpecialistFailure = (
  buildDir: string | undefined,
  perspective: string,
  reason: "timeout" | "error",
  detail: string,
  stage?: SpecialistStage,
): void => {
  if (!buildDir) return
  try {
    logTrajectory(buildDir, "specialist_fail", null, `Specialist ${perspective} failed: ${detail}`, {
      reason,
      specialist: perspective,
      stage,
    })
  } catch {
    // trajectory is best-effort
  }
}

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
      timeoutMs: (config.specialistTimeoutSeconds ?? DEFAULT_SPECIALIST_TIMEOUT_SECONDS) * 1000,
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

/** Parse all successful specialists' skeletons and decide whether synthesis should be skipped. */
const detectAgreement = <TDraft>(
  config: EnsembleConfig<TDraft>,
  successful: { perspective: string; result: ClaudeResult; draft: TDraft }[],
): { isAgreed: boolean; hadMalformed: boolean; verdicts: (SpecialistVerdict | null)[] } => {
  if (!config.stage || !config.onAgreementSkip || successful.length < 2) {
    return { isAgreed: false, hadMalformed: false, verdicts: [] }
  }
  const stage = config.stage
  const verdicts = successful.map((s) =>
    parseSpecialistVerdict(stage, config.skeletonSource ? config.skeletonSource(s.result, s.draft) : s.result.result),
  )
  const hadMalformed = verdicts.some((v) => v === null)
  if (hadMalformed) {
    printWarn(`[ridgeline] WARN: one or more specialist verdicts did not parse; running synthesis`)
    return { isAgreed: false, hadMalformed: true, verdicts }
  }
  return { isAgreed: skeletonsAgree(verdicts), hadMalformed: false, verdicts }
}

type Spinner = ReturnType<typeof startSpinner>
type Successful<TDraft> = { perspective: string; result: ClaudeResult; draft: TDraft }

const dispatchSpecialists = async <TDraft>(
  config: EnsembleConfig<TDraft>,
  spinner: Spinner,
): Promise<PromiseSettledResult<{ perspective: string; result: ClaudeResult }>[]> => {
  const specialistTimeoutMs = (config.specialistTimeoutSeconds ?? DEFAULT_SPECIALIST_TIMEOUT_SECONDS) * 1000
  const isStructured = config.isStructured !== false

  const promises = config.specialists.map(({ perspective, overlay }) => {
    const systemPrompt = config.buildSpecialistPrompt(overlay)
    const startTime = Date.now()
    return invokeClaude({
      systemPrompt,
      userPrompt: config.specialistUserPrompt,
      model: config.model,
      allowedTools: config.specialistTools ?? [],
      cwd: process.cwd(),
      timeoutMs: specialistTimeoutMs,
      jsonSchema: isStructured ? config.specialistSchema : undefined,
      onStderr: createStderrHandler(perspective),
      networkAllowlist: config.networkAllowlist,
      sandboxProvider: config.sandboxProvider,
    }).then(
      (result) => {
        const elapsed = formatElapsed(Date.now() - startTime)
        const line = `  ${perspective.padEnd(14)} complete (${elapsed}, $${result.costUsd.toFixed(2)})`
        spinner.printAbove(line)
        appendTranscript(line)
        return { perspective, result } as const
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        const reason: "timeout" | "error" = isTimeoutMessage(message) ? "timeout" : "error"
        printError(`Specialist ${perspective} failed (${reason}): ${message}`)
        logSpecialistFailure(config.buildDir, perspective, reason, message, config.stage)
        throw err
      },
    )
  })

  return Promise.allSettled(promises)
}

const collectSuccessful = <TDraft>(
  config: EnsembleConfig<TDraft>,
  settled: PromiseSettledResult<{ perspective: string; result: ClaudeResult }>[],
): Successful<TDraft>[] => {
  const successful: Successful<TDraft>[] = []
  const isStructured = config.isStructured !== false

  for (const outcome of settled) {
    if (outcome.status !== "fulfilled") continue
    const { perspective, result } = outcome.value

    if (!isStructured) {
      successful.push({ perspective, result, draft: result.result as TDraft })
      continue
    }

    try {
      const draft = extractJSON(result.result) as TDraft
      successful.push({ perspective, result, draft })
    } catch {
      const preview = result.result.length > 300
        ? result.result.slice(0, 300) + "..."
        : result.result
      printError(`Failed to parse ${perspective} specialist output as JSON. Preview:\n${preview}`)
      logSpecialistFailure(config.buildDir, perspective, "error", "malformed JSON output", config.stage)
    }
  }

  return successful
}

const aggregateResult = <TDraft>(
  successful: Successful<TDraft>[],
  annotations: AnnotationEntry[],
  preSynthCost: number,
  synthResult: ClaudeResult,
): EnsembleResult => {
  const specialistResults = successful.map((s) => s.result)
  const annotationResults = annotations.map((a) => a.result)
  const specialistWallMs = Math.max(...specialistResults.map((r) => r.durationMs))
  const annotationWallMs = annotationResults.length > 0
    ? Math.max(...annotationResults.map((r) => r.durationMs))
    : 0
  const totalDurationMs = specialistWallMs + annotationWallMs + synthResult.durationMs

  return {
    specialistNames: successful.map((s) => s.perspective),
    specialistResults,
    ...(annotationResults.length > 0 ? { annotationResults } : {}),
    synthesizerResult: synthResult,
    totalCostUsd: preSynthCost + synthResult.costUsd,
    totalDurationMs,
  }
}

const runSynthesizer = async <TDraft>(
  config: EnsembleConfig<TDraft>,
  successful: Successful<TDraft>[],
  annotations: AnnotationEntry[],
): Promise<ClaudeResult> => {
  printInfo("Synthesizing from specialist proposals...")
  const { onStdout, flush } = createDisplayCallbacks({ projectRoot: process.cwd(), dimText: true })
  const synthUserPrompt = buildSynthPrompt(
    config,
    successful.map(({ perspective, draft }) => ({ perspective, draft })),
    annotations,
  )
  try {
    return await invokeClaude({
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
}

const logSkip = (buildDir: string | undefined, count: number, stage: SpecialistStage): void => {
  if (!buildDir) return
  try {
    logTrajectory(buildDir, "synthesis_skipped", null,
      `synthesis skipped: ${count} specialists agreed on structured verdict (${stage})`,
      { stage })
  } catch {
    // trajectory is best-effort
  }
}

export const invokeEnsemble = async <TDraft>(
  config: EnsembleConfig<TDraft>
): Promise<EnsembleResult> => {
  const specialists = config.specialists
  if (specialists.length === 0) {
    throw new Error(`No specialist agents found for ${config.label}`)
  }

  const spinner = startSpinner(config.label)

  const settled = await dispatchSpecialists(config, spinner)
  const successful = collectSuccessful<TDraft>(config, settled)

  if (successful.length === 0) {
    spinner.stop()
    throw new Error(
      `${config.label} had all ${specialists.length} specialists fail. ` +
      "Check Claude authentication and try again.",
    )
  }

  if (successful.length < specialists.length) {
    printWarn(`Continuing with ${successful.length} of ${specialists.length} specialist proposals`)
  }

  const annotations = await runAnnotationPass(config, successful)

  const specialistCost = successful.reduce((sum, s) => sum + s.result.costUsd, 0)
  const annotationCost = annotations.reduce((sum, a) => sum + a.result.costUsd, 0)
  const preSynthCost = specialistCost + annotationCost
  if (config.maxBudgetUsd !== null && preSynthCost >= config.maxBudgetUsd) {
    spinner.stop()
    throw new Error(
      `Pre-synthesis cost ($${preSynthCost.toFixed(2)}) already exceeds budget ($${config.maxBudgetUsd.toFixed(2)}). ` +
      "Skipping synthesis to avoid further cost.",
    )
  }

  const agreement = detectAgreement(config, successful)
  if (agreement.isAgreed && config.onAgreementSkip) {
    spinner.stop()
    const count = successful.length
    const stage = config.stage as SpecialistStage
    printInfo(`Synthesis skipped: ${count} specialists agreed on structured verdict (${stage})`)
    logSkip(config.buildDir, count, stage)

    const synthResult = await config.onAgreementSkip(successful)
    if (config.verify) config.verify()
    return aggregateResult(successful, annotations, preSynthCost, synthResult)
  }

  spinner.stop()
  const synthResult = await runSynthesizer(config, successful, annotations)
  if (config.verify) config.verify()
  return aggregateResult(successful, annotations, preSynthCost, synthResult)
}

/**
 * Cap a registered specialist list to the configured ensemble size.
 * Default size: 3 (use all). Pass 1 or 2 to opt out of the deeper ensemble.
 */
export const selectSpecialists = (
  all: SpecialistDef[],
  { specialistCount }: { specialistCount: 1 | 2 | 3 },
): SpecialistDef[] => all.slice(0, specialistCount)

/**
 * Append the audit note that marks an agreement-based synthesis skip.
 * Idempotent when applied more than once to the same artifact.
 */
export const appendSkipAuditNote = (filepath: string, count: number, stage: SpecialistStage): void => {
  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, "")
  }
  const message = `synthesis skipped: ${count} specialists agreed on structured verdict (${stage})`
  const existing = fs.readFileSync(filepath, "utf-8")
  if (existing.includes(message)) return
  fs.appendFileSync(filepath, `\n\n${message}\n`)
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
    _skeleton: {
      type: "object",
      description: "Compact agreement-detection skeleton used to decide whether synthesis can be skipped.",
      properties: {
        phaseList: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "e.g., '01-scaffold'" },
              slug: { type: "string" },
            },
            required: ["id", "slug"],
          },
        },
        depGraph: {
          type: "array",
          items: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 2,
          },
        },
      },
      required: ["phaseList", "depGraph"],
    },
  },
  required: ["perspective", "summary", "phases", "tradeoffs", "_skeleton"],
})

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
    "",
    "Finally include a `_skeleton` field summarizing your plan:",
    "- `phaseList`: array of { id, slug } entries in sequential order; id is `NN-<slug>` (two-digit index).",
    "- `depGraph`: array of [from, to] id pairs describing cross-phase dependencies.",
    "The `_skeleton` is used for ensemble agreement detection; keep it faithful to the main plan.",
  ].join("\n")

  return `${context}\n\n${overlay}${jsonDirective}`
}

const assemblePlannerSpecialistUserPrompt = (config: RidgelineConfig): string => {
  const doc = createPromptDocument()
  appendBaseUserPrompt(doc, config)
  doc.instruction("Output Format", "IMPORTANT: Respond with ONLY a JSON object. No prose, no markdown, no commentary. Just the JSON.")
  return doc.render()
}

const assemblePlannerSynthesizerUserPrompt = (
  config: RidgelineConfig,
  drafts: { perspective: string; draft: SpecialistProposal }[],
): string => {
  const doc = createPromptDocument()
  appendBaseUserPrompt(doc, config)

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

  doc.instruction(
    "Output Directory",
    `Write phase spec files to: ${config.phasesDir}\nUse the naming convention: 01-<slug>.md, 02-<slug>.md, etc.`,
  )

  return doc.render()
}

/** Write phase files directly from the first specialist's proposal when synthesis is skipped. */
const writePhasesFromProposal = async (
  config: RidgelineConfig,
  proposal: SpecialistProposal,
): Promise<void> => {
  fs.mkdirSync(config.phasesDir, { recursive: true })
  for (let i = 0; i < proposal.phases.length; i++) {
    const phase = proposal.phases[i]
    const id = `${String(i + 1).padStart(2, "0")}-${phase.slug}`
    const filepath = `${config.phasesDir}/${id}.md`
    const lines: string[] = []
    const depends = Array.isArray((phase as unknown as { dependsOn?: string[] }).dependsOn)
      ? (phase as unknown as { dependsOn?: string[] }).dependsOn
      : null
    if (depends && depends.length > 0) {
      lines.push("---")
      lines.push(`depends_on: [${depends.join(", ")}]`)
      lines.push("---")
      lines.push("")
    }
    lines.push(`# Phase ${i + 1}: ${phase.title}`)
    lines.push("")
    lines.push("## Goal")
    lines.push("")
    lines.push(phase.goal.trim())
    lines.push("")
    lines.push("## Acceptance Criteria")
    lines.push("")
    for (let j = 0; j < phase.acceptanceCriteria.length; j++) {
      lines.push(`${j + 1}. ${phase.acceptanceCriteria[j]}`)
    }
    lines.push("")
    lines.push("## Spec Reference")
    lines.push("")
    lines.push(phase.specReference.trim())
    lines.push("")
    lines.push("## Rationale")
    lines.push("")
    lines.push(phase.rationale.trim())
    lines.push("")
    fs.writeFileSync(filepath, lines.join("\n"))
  }
}

export const invokePlanner = async (
  config: RidgelineConfig,
): Promise<{ result: ClaudeResult; phases: PhaseInfo[]; ensemble: EnsembleResult }> => {
  const registry = buildAgentRegistry()
  const context = registry.getContext("planners") ?? ""
  const availableSpecialists = registry.getSpecialists("planners")
  const specialists = selectSpecialists(availableSpecialists, { specialistCount: config.specialistCount })

  const ensemble = await invokeEnsemble<SpecialistProposal>({
    label: "Planning",
    specialists,

    buildSpecialistPrompt: (overlay) => buildPlannerSpecialistPrompt(context, overlay),
    specialistUserPrompt: assemblePlannerSpecialistUserPrompt(config),
    specialistSchema: SPECIALIST_PROPOSAL_SCHEMA,

    synthesizerPrompt: registry.getCorePrompt("planner.md"),
    buildSynthesizerUserPrompt: (drafts) =>
      assemblePlannerSynthesizerUserPrompt(config, drafts),
    synthesizerTools: ["Write", "Skill"],

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

    stage: "plan",
    buildDir: config.buildDir,
    onAgreementSkip: async (successful) => {
      const [first] = successful
      await writePhasesFromProposal(config, first.draft)
      const firstPhase = scanPhases(config.phasesDir)[0]
      if (firstPhase) {
        appendSkipAuditNote(firstPhase.filepath, successful.length, "plan")
      }
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
