import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"
import { execFileSync } from "node:child_process"
import type {
  RidgelineConfig,
  PhaseInfo,
  ClaudeResult,
  BuilderInvocation,
  BuilderInvocationEndReason,
} from "../../types"
import { computeBuilderBudget } from "./builder.budget"
import type { BuilderBudget } from "./builder.budget"
import { parseBuilderMarker } from "./builder.marker"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { assembleUserPrompt, invokeBuilder } from "./build.exec"

export const DEFAULT_MAX_CONTINUATIONS = 5
export const DEFAULT_PHASE_COST_CAP_MULTIPLIER = 5
export const PROGRESS_TRIM_THRESHOLD_TOKENS = 20_000

export interface BuilderLoopOutcome {
  invocations: BuilderInvocation[]
  finalResult: ClaudeResult | null
  cumulativeOutputTokens: number
  cumulativeCostUsd: number
  endReason: BuilderInvocationEndReason
}

export interface BuilderLoopOptions {
  maxContinuations?: number
  softFraction?: number
  hardFraction?: number
  phaseCostCapMultiplier?: number
}

export interface BuilderInvocationContext {
  attempt: number
  isContinuation: boolean
  budget: BuilderBudget
  progressFileContent: string
  progressFilePath: string
}

export type BuilderInvoker = (
  config: RidgelineConfig,
  phase: PhaseInfo,
  feedbackPath: string | null,
  cwd: string | undefined,
  ctx: BuilderInvocationContext,
) => Promise<ClaudeResult>

export type DiffHasher = (cwd: string) => string | null

export type InvocationCompleteHook = (
  record: BuilderInvocation,
  result: ClaudeResult | null,
) => void

export interface BuilderLoopArgs {
  config: RidgelineConfig
  phase: PhaseInfo
  feedbackPath: string | null
  cwd?: string
  options?: BuilderLoopOptions
  /** Override the per-call invoker (for tests). */
  invoker?: BuilderInvoker
  /** Override the diff hasher (for tests). */
  diffHasher?: DiffHasher
  /** Pre-existing phase cost (e.g. from prior reviewer retries). */
  cumulativeCostStart?: number
  /** Predicate: did the global budget cap fire after this invocation? */
  globalBudgetCheck?: (cumulativeCostUsd: number) => boolean
  /**
   * Side-effect hook fired after each invocation finishes (success, timeout, or implicit).
   * Used by the orchestrator to persist cost, log trajectory events, etc.
   */
  onInvocationComplete?: InvocationCompleteHook
}

const TIMEOUT_MARKER = "Claude invocation timed out"

const isTimeoutError = (err: unknown): boolean =>
  err instanceof Error && err.message.includes(TIMEOUT_MARKER)

const sha256 = (input: string): string =>
  crypto.createHash("sha256").update(input).digest("hex")

/**
 * Hash the working-tree diff against HEAD inside `cwd`. Used for
 * "no progress" detection between continuations: if two invocations
 * produce the same diff, the builder is spinning.
 */
export const defaultDiffHasher: DiffHasher = (cwd: string): string | null => {
  try {
    const diff = execFileSync("git", ["diff", "--no-color", "HEAD"], {
      cwd,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    })
    return sha256(diff)
  } catch {
    return null
  }
}

const renderBudgetInstruction = (budget: BuilderBudget): string => {
  return [
    `Soft target: ~${budget.softLimit.toLocaleString()} output tokens.`,
    `  Aim to land natural breakpoints around this number.`,
    `Hard limit: ~${budget.hardLimit.toLocaleString()} output tokens.`,
    `  Stop AT or BEFORE this number — exceeding it risks truncation.`,
    `Context window: ${budget.contextWindow.toLocaleString()} tokens total`,
    `(input estimate: ${budget.inputTokensEstimate.toLocaleString()};`,
    ` output budget: ${budget.outputBudget.toLocaleString()}).`,
    "",
    "Conclude your final message with EXACTLY ONE of:",
    "  READY_FOR_REVIEW",
    "    — when all acceptance criteria are met and the reviewer should run.",
    "  MORE_WORK_NEEDED: <one-line reason>",
    "    — when valid work was completed but unfinished items remain.",
    "    Append to the builder progress file (path below) before exiting,",
    "    describing what's done, what's left, and any gotchas.",
  ].join("\n")
}

const renderContinuationPreamble = (attempt: number, progressContent: string): string => {
  return [
    `This is continuation ${attempt} of this phase. The previous builder`,
    `wound down because more work remained. Read the progress notes below`,
    `(also stored on disk for the next continuation if needed) and pick up`,
    `from where they left off. Do NOT redo finished work.`,
    "",
    "## Builder progress so far",
    "",
    progressContent.trim(),
  ].join("\n")
}

/**
 * Default invoker: delegates to `invokeBuilder` with budget + continuation
 * extras layered on. Tests can override this hook to bypass Claude entirely.
 */
export const defaultInvoker: BuilderInvoker = async (
  config,
  phase,
  feedbackPath,
  cwd,
  ctx,
) =>
  invokeBuilder(config, phase, feedbackPath, cwd, {
    budgetInstruction: renderBudgetInstruction(ctx.budget),
    continuationPreamble: ctx.isContinuation
      ? renderContinuationPreamble(ctx.attempt, ctx.progressFileContent)
      : undefined,
    progressFilePath: ctx.progressFilePath,
  })

const readProgressFile = (filePath: string): string => {
  if (!fs.existsSync(filePath)) return ""
  return fs.readFileSync(filePath, "utf-8")
}

const computeBudgetForIteration = (
  config: RidgelineConfig,
  phase: PhaseInfo,
  feedbackPath: string | null,
  cwd: string | undefined,
  progressContent: string,
  options: BuilderLoopOptions,
): BuilderBudget => {
  // Approximate the prompt size for budget computation. The real prompt
  // assembly happens inside the invoker; here we estimate from the same
  // inputs to avoid a circular dependency on the builder system prompt.
  const baseUserPrompt = assembleUserPrompt(config, phase, feedbackPath, cwd)
  const continuationPayload = progressContent.length > 0
    ? renderContinuationPreamble(2, progressContent)
    : ""
  const userPromptApprox = `${baseUserPrompt}\n\n${continuationPayload}`
  // System prompt — load via registry; cheap.
  const registry = buildAgentRegistry()
  let systemPrompt = ""
  try {
    systemPrompt = registry.getCorePrompt("builder.md")
  } catch {
    systemPrompt = ""
  }
  return computeBuilderBudget(systemPrompt, userPromptApprox, config, {
    softFraction: options.softFraction,
    hardFraction: options.hardFraction,
  })
}

interface MarkerClassification {
  endReason: BuilderInvocationEndReason
  windDownReason: string | null
}

const classifyMarker = (resultText: string): MarkerClassification => {
  const marker = parseBuilderMarker(resultText)
  if (marker.kind === "ready_for_review") {
    return { endReason: "ready_for_review", windDownReason: null }
  }
  return {
    endReason: marker.explicit ? "more_work_explicit" : "more_work_implicit",
    windDownReason: marker.reason,
  }
}

interface HaltContext {
  attempt: number
  maxContinuations: number
  cumulativeCostUsd: number
  phaseCostCap: number | null
  globalBudgetCheck: ((cost: number) => boolean) | undefined
  diffHash: string | null
  prevDiffHash: string | null
}

/** Apply halt overrides in priority order. Returns the new end reason. */
const applyHaltOverrides = (
  current: BuilderInvocationEndReason,
  ctx: HaltContext,
): BuilderInvocationEndReason => {
  if (ctx.phaseCostCap !== null && ctx.cumulativeCostUsd > ctx.phaseCostCap) {
    return "halt_phase_cost_cap"
  }
  if (ctx.globalBudgetCheck && ctx.globalBudgetCheck(ctx.cumulativeCostUsd)) {
    return "halt_global_budget"
  }
  if (current === "ready_for_review") return current
  if (
    ctx.prevDiffHash !== null &&
    ctx.diffHash !== null &&
    ctx.diffHash === ctx.prevDiffHash
  ) {
    return "halt_no_progress"
  }
  if (ctx.attempt >= ctx.maxContinuations) {
    return "halt_max_continuations"
  }
  return current
}

const HALT_END_REASONS: ReadonlySet<BuilderInvocationEndReason> = new Set([
  "ready_for_review",
  "halt_max_continuations",
  "halt_no_progress",
  "halt_phase_cost_cap",
  "halt_global_budget",
])

const isLoopExit = (reason: BuilderInvocationEndReason): boolean =>
  HALT_END_REASONS.has(reason)

interface InvocationOutcome {
  result: ClaudeResult | null
  endReason: BuilderInvocationEndReason
  windDownReason: string | null
  durationMs: number
}

/**
 * Call the invoker once. Convert timeouts into a `timeout` end-reason
 * (so the loop continues); rethrow any other error after recording the
 * invocation as `error`.
 */
const performInvocation = async (
  invoker: BuilderInvoker,
  config: RidgelineConfig,
  phase: PhaseInfo,
  feedbackPath: string | null,
  cwd: string | undefined,
  ctx: BuilderInvocationContext,
): Promise<InvocationOutcome> => {
  const startedAt = Date.now()
  try {
    const result = await invoker(config, phase, feedbackPath, cwd, ctx)
    const { endReason, windDownReason } = classifyMarker(result.result)
    return {
      result,
      endReason,
      windDownReason,
      durationMs: result.durationMs || Date.now() - startedAt,
    }
  } catch (err) {
    if (isTimeoutError(err)) {
      return {
        result: null,
        endReason: "timeout",
        windDownReason: "invocation timed out",
        durationMs: Date.now() - startedAt,
      }
    }
    throw err
  }
}

const recordInvocation = (
  attempt: number,
  outcome: InvocationOutcome,
  finalReason: BuilderInvocationEndReason,
  diffHash: string | null,
): BuilderInvocation => ({
  attempt,
  endReason: finalReason,
  outputTokens: outcome.result?.usage.outputTokens ?? 0,
  inputTokens: outcome.result?.usage.inputTokens ?? 0,
  costUsd: outcome.result?.costUsd ?? 0,
  durationMs: outcome.durationMs,
  windDownReason: outcome.windDownReason,
  diffHash,
  timestamp: new Date().toISOString(),
})

/**
 * Run the builder loop for a phase: keep invoking fresh-context builders
 * until the phase is `READY_FOR_REVIEW`, the loop hits a halt condition,
 * or an unrecoverable error bubbles. Each invocation is a separate Claude
 * call; continuations read the per-phase builder-progress file to pick
 * up state.
 */
export const runBuilderLoop = async (args: BuilderLoopArgs): Promise<BuilderLoopOutcome> => {
  const {
    config,
    phase,
    feedbackPath,
    cwd,
    options = {},
    invoker = defaultInvoker,
    diffHasher = defaultDiffHasher,
    cumulativeCostStart = 0,
    globalBudgetCheck,
  } = args

  const maxContinuations = options.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS
  const phaseCostCapMultiplier = options.phaseCostCapMultiplier ?? DEFAULT_PHASE_COST_CAP_MULTIPLIER
  const phaseCostCap = config.phaseBudgetLimit !== null
    ? config.phaseBudgetLimit * phaseCostCapMultiplier
    : null

  const progressFilePath = path.join(config.phasesDir, `${phase.id}.builder-progress.md`)

  const invocations: BuilderInvocation[] = []
  let cumulativeOutputTokens = 0
  let cumulativeCostUsd = cumulativeCostStart
  let prevDiffHash: string | null = null
  let finalResult: ClaudeResult | null = null

  for (let attempt = 1; attempt <= maxContinuations; attempt++) {
    const progressContent = readProgressFile(progressFilePath)
    const budget = computeBudgetForIteration(config, phase, feedbackPath, cwd, progressContent, options)

    const ctx: BuilderInvocationContext = {
      attempt,
      isContinuation: attempt > 1,
      budget,
      progressFileContent: progressContent,
      progressFilePath,
    }

    const outcome = await performInvocation(invoker, config, phase, feedbackPath, cwd, ctx)
    const diffHash = cwd ? diffHasher(cwd) : null

    if (outcome.result) {
      cumulativeOutputTokens += outcome.result.usage.outputTokens
      cumulativeCostUsd += outcome.result.costUsd
      finalResult = outcome.result
    }

    const finalReason = applyHaltOverrides(outcome.endReason, {
      attempt,
      maxContinuations,
      cumulativeCostUsd,
      phaseCostCap,
      globalBudgetCheck,
      diffHash,
      prevDiffHash,
    })

    const record = recordInvocation(attempt, outcome, finalReason, diffHash)
    invocations.push(record)
    args.onInvocationComplete?.(record, outcome.result)

    if (isLoopExit(finalReason)) break

    prevDiffHash = diffHash
  }

  const last = invocations[invocations.length - 1]
  return {
    invocations,
    finalResult,
    cumulativeOutputTokens,
    cumulativeCostUsd,
    endReason: last?.endReason ?? "error",
  }
}
