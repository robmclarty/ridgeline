import { RidgelineConfig, PhaseInfo, ClaudeResult, SpecialistProposal, EnsembleResult } from "../../types"
import { invokeClaude } from "../claude/claude.exec"
import { createDisplayCallbacks } from "../claude/stream.display"
import { scanPhases } from "../../stores/phases"
import { printInfo, printError } from "../../ui/output"
import { startSpinner, formatElapsed } from "../../ui/spinner"
import { buildAgentRegistry, SpecialistDef } from "../discovery/agent.registry"
import { resolveFlavour } from "../discovery/flavour.resolve"
import { assembleBaseUserPrompt } from "./plan.exec"
import { createStderrHandler, formatProposalHeading } from "./pipeline.shared"

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
    const isStructured = config.isStructured !== false // default true

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
      spinner.printAbove(`  ${perspective.padEnd(14)} complete (${elapsed}, $${result.costUsd.toFixed(2)})`)
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
        // Prose mode: treat the raw result text as the draft
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

  // 5. Budget guard
  const specialistCost = successful.reduce((sum, s) => sum + s.result.costUsd, 0)
  if (config.maxBudgetUsd !== null && specialistCost >= config.maxBudgetUsd) {
    spinner.stop()
    throw new Error(
      `Specialist cost ($${specialistCost.toFixed(2)}) already exceeds budget ($${config.maxBudgetUsd.toFixed(2)}). ` +
      "Skipping synthesis to avoid further cost."
    )
  }

  // 6. Synthesize
  spinner.stop()
  printInfo("Synthesizing from specialist proposals...")

  const { onStdout, flush } = createDisplayCallbacks({ projectRoot: process.cwd() })

  let synthResult: ClaudeResult
  try {
    synthResult = await invokeClaude({
      systemPrompt: config.synthesizerPrompt,
      userPrompt: config.buildSynthesizerUserPrompt(
        successful.map(({ perspective, draft }) => ({ perspective, draft })),
      ),
      model: config.model,
      allowedTools: config.synthesizerTools,
      cwd: process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      onStdout,
      onStderr: createStderrHandler("synthesizer"),
    })
  } finally {
    flush()
  }

  // 7. Post-synthesis verification
  if (config.verify) {
    config.verify()
  }

  // 8. Aggregate results
  const specialistResults = successful.map((s) => s.result)
  const totalCostUsd = specialistCost + synthResult.costUsd
  const totalDurationMs = Math.max(...specialistResults.map((r) => r.durationMs)) + synthResult.durationMs

  return {
    specialistResults,
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
  return assembleBaseUserPrompt(config) + "\n\nIMPORTANT: Respond with ONLY a JSON object. No prose, no markdown, no commentary. Just the JSON."
}

/** Assemble the user prompt for the planner synthesizer, including all proposals. */
const assemblePlannerSynthesizerUserPrompt = (
  config: RidgelineConfig,
  drafts: { perspective: string; draft: SpecialistProposal }[],
): string => {
  const sections: string[] = []

  // Include original inputs
  sections.push(assembleBaseUserPrompt(config))
  sections.push("")

  // Include each specialist proposal
  sections.push("## Specialist Proposals\n")
  for (const { perspective, draft } of drafts) {
    formatProposalHeading(sections, perspective, draft.tradeoffs)
    sections.push(`**Summary:** ${draft.summary}\n`)
    sections.push(`**Phases (${draft.phases.length}):**\n`)
    for (let i = 0; i < draft.phases.length; i++) {
      const phase = draft.phases[i]
      sections.push(`#### Phase ${i + 1}: ${phase.title} (\`${phase.slug}\`)`)
      sections.push(`**Goal:** ${phase.goal}\n`)
      sections.push("**Acceptance Criteria:**")
      for (const criterion of phase.acceptanceCriteria) {
        sections.push(`- ${criterion}`)
      }
      sections.push(`\n**Spec Reference:** ${phase.specReference}`)
      sections.push(`**Rationale:** ${phase.rationale}\n`)
    }
    sections.push("---\n")
  }

  // Output directory
  sections.push("## Output Directory\n")
  sections.push(`Write phase spec files to: ${config.phasesDir}`)
  sections.push("Use the naming convention: 01-<slug>.md, 02-<slug>.md, etc.")

  return sections.join("\n")
}

export const invokePlanner = async (
  config: RidgelineConfig
): Promise<{ result: ClaudeResult; phases: PhaseInfo[]; ensemble: EnsembleResult }> => {
  const registry = buildAgentRegistry(resolveFlavour(config.flavour))
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
    synthesizerTools: ["Write"],

    model: config.model,
    timeoutMinutes: config.timeoutMinutes,
    maxBudgetUsd: config.maxBudgetUsd,

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
