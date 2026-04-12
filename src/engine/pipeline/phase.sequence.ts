import { RidgelineConfig, PhaseInfo, BuildState, ClaudeResult, ReviewVerdict } from "../../types"
import { createCheckpoint, createCompletionTag } from "../../stores/tags"
import { recordCost } from "../../stores/budget"
import { ensureHandoffExists } from "../../stores/handoff"
import { formatIssue } from "../../stores/feedback.verdict"
import { writeFeedback, archiveFeedback } from "../../stores/feedback.io"
import { logTrajectory } from "../../stores/trajectory"
import { updatePhaseStatus } from "../../stores/state"
import { printPhase } from "../../ui/output"
import { commitAll, isWorkingTreeDirty } from "../../git"
import { invokeBuilder } from "./build.exec"
import { invokeReviewer } from "./review.exec"

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** Exponential backoff with jitter. Base doubles per attempt, capped at 60s. */
export const backoffMs = (attempt: number): number => {
  const base = Math.min(1000 * Math.pow(2, attempt), 60_000)
  const jitter = Math.random() * base * 0.5
  return Math.round(base + jitter)
}

const FATAL_PATTERNS = [
  "authentication failed",
  "unauthorized",
  "forbidden",
  "invalid_api_key",
  "oauth token has expired",
]

/** Classify an invocation error as fatal (don't retry) or transient (retry with backoff). */
const classifyError = (msg: string): "fatal" | "transient" => {
  const lower = msg.toLowerCase()
  if (FATAL_PATTERNS.some((p) => lower.includes(p))) return "fatal"
  return "transient"
}

const handleInvokeError = (
  err: unknown,
  step: "build" | "review",
  phase: PhaseInfo,
  config: RidgelineConfig,
  state: BuildState,
): "fatal" | "transient" => {
  const label = step === "build" ? "Build" : "Review"
  const event = step === "build" ? "build_complete" : "review_complete"
  const msg = String(err)
  const classification = classifyError(msg)

  printPhase(phase.id, `${label} failed (${classification}): ${msg}`)
  logTrajectory(config.buildDir, event, phase.id, `${label} error (${classification}): ${msg}`)

  if (classification === "fatal") {
    updatePhaseStatus(config.buildDir, state, phase.id, { status: "failed", failedAt: new Date().toISOString() })
  }
  return classification
}

const isBudgetExceeded = (
  totalCostUsd: number,
  config: RidgelineConfig,
  phase: PhaseInfo,
  state: BuildState,
): boolean => {
  if (!config.maxBudgetUsd || totalCostUsd <= config.maxBudgetUsd) return false
  printPhase(phase.id, `Budget exceeded: $${totalCostUsd.toFixed(2)} > $${config.maxBudgetUsd}`)
  logTrajectory(config.buildDir, "budget_exceeded", phase.id,
    `Total cost $${totalCostUsd.toFixed(2)} exceeds budget $${config.maxBudgetUsd}`)
  updatePhaseStatus(config.buildDir, state, phase.id, { status: "failed", failedAt: new Date().toISOString() })
  return true
}

const executeBuild = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  state: BuildState,
  attempt: number,
  feedbackFilePath: string | null,
  sandboxNote: string,
): Promise<{ result: ClaudeResult; isBudgetExceeded: boolean }> => {
  const isRetry = attempt > 0
  printPhase(phase.id, isRetry ? `Retry ${attempt}: building...` : "Building...")
  logTrajectory(config.buildDir, "build_start", phase.id, `Build attempt ${attempt + 1}${sandboxNote}`)

  const wallStart = Date.now()
  const result = await invokeBuilder(config, phase, feedbackFilePath)
  result.durationMs = Date.now() - wallStart

  logTrajectory(config.buildDir, "build_complete", phase.id, "Build complete", {
    duration: result.durationMs,
    tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens },
    costUsd: result.costUsd,
  })

  const budget = recordCost(config.buildDir, phase.id, "builder", attempt, result)

  // Commit builder work so the reviewer can see the diff
  if (isWorkingTreeDirty()) {
    commitAll(`ridgeline: builder work for ${phase.id} (attempt ${attempt + 1})`)
  }

  return { result, isBudgetExceeded: isBudgetExceeded(budget.totalCostUsd, config, phase, state) }
}

const executeReview = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  state: BuildState,
  attempt: number,
  checkpointTag: string,
  sandboxNote: string,
): Promise<{ result: ClaudeResult; verdict: ReviewVerdict }> => {
  printPhase(phase.id, "Reviewing...")
  updatePhaseStatus(config.buildDir, state, phase.id, { status: "reviewing" })
  logTrajectory(config.buildDir, "review_start", phase.id, `Review attempt ${attempt + 1}${sandboxNote}`)

  const wallStart = Date.now()
  const { result, verdict } = await invokeReviewer(config, phase, checkpointTag)
  result.durationMs = Date.now() - wallStart

  logTrajectory(config.buildDir, "review_complete", phase.id, verdict.summary, {
    duration: result.durationMs,
    tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens },
    costUsd: result.costUsd,
  })

  recordCost(config.buildDir, phase.id, "reviewer", attempt, result)

  return { result, verdict }
}

const handleExhaustion = (
  config: RidgelineConfig,
  phase: PhaseInfo,
  state: BuildState,
  attempt: number,
  startTime: number,
  checkpointTag: string,
): "failed" => {
  const duration = Date.now() - startTime
  updatePhaseStatus(config.buildDir, state, phase.id, {
    status: "failed",
    retries: attempt,
    duration,
    failedAt: new Date().toISOString(),
  })

  printPhase(phase.id, "FAILED: retries exhausted")
  logTrajectory(config.buildDir, "phase_fail", phase.id, "Retries exhausted")

  console.log("")
  console.log(`Recovery: git reset --hard ${checkpointTag}`)
  console.log("Options:")
  console.log("  1. Edit spec.md and re-run: ridgeline plan <build> && ridgeline build <build>")
  console.log(`  2. Edit the phase spec directly: ${phase.filepath}`)
  console.log(`  3. Resume after manual fixes: ridgeline build ${config.buildName}`)

  return "failed"
}

export const runPhase = async (
  phase: PhaseInfo,
  config: RidgelineConfig,
  state: BuildState
): Promise<"passed" | "failed"> => {
  const phaseState = state.phases.find((p) => p.id === phase.id)
  if (!phaseState) throw new Error(`Phase ${phase.id} not found in state`)

  const checkpointTag = phaseState.checkpointTag
  const startTime = Date.now()

  createCheckpoint(checkpointTag, phase.id)
  ensureHandoffExists(config.buildDir)

  let attempt = phaseState.retries
  const maxAttempts = config.maxRetries + 1
  const sandboxNote = config.sandboxProvider ? ` [sandbox: ${config.sandboxProvider.name}]` : ""

  while (attempt < maxAttempts) {
    const feedbackFilePath = attempt > 0
      ? phase.filepath.replace(/\.md$/, ".feedback.md")
      : null

    try {
      const build = await executeBuild(config, phase, state, attempt, feedbackFilePath, sandboxNote)
      if (build.isBudgetExceeded) return "failed"
    } catch (err) {
      if (handleInvokeError(err, "build", phase, config, state) === "fatal") return "failed"
      const delay = backoffMs(attempt)
      printPhase(phase.id, `Waiting ${(delay / 1000).toFixed(1)}s before retry...`)
      await sleep(delay)
      attempt++
      continue
    }

    let verdict: ReviewVerdict
    try {
      const review = await executeReview(config, phase, state, attempt, checkpointTag, sandboxNote)
      verdict = review.verdict
    } catch (err) {
      if (handleInvokeError(err, "review", phase, config, state) === "fatal") return "failed"
      const delay = backoffMs(attempt)
      printPhase(phase.id, `Waiting ${(delay / 1000).toFixed(1)}s before retry...`)
      await sleep(delay)
      attempt++
      continue
    }

    if (verdict.passed) {
      const duration = Date.now() - startTime
      const completionTag = createCompletionTag(config.buildName, phase.id)

      updatePhaseStatus(config.buildDir, state, phase.id, {
        status: "complete",
        completionTag,
        duration,
        completedAt: new Date().toISOString(),
      })

      printPhase(phase.id, `PASSED (${(duration / 1000).toFixed(0)}s)`)
      logTrajectory(config.buildDir, "phase_advance", phase.id, "Phase passed")
      return "passed"
    }

    printPhase(phase.id, `FAILED: ${verdict.summary}`)
    for (const issue of verdict.issues) {
      printPhase(phase.id, `  - ${formatIssue(issue)}`)
    }

    archiveFeedback(phase.filepath, phase.id, verdict, attempt)
    writeFeedback(phase.filepath, phase.id, verdict)

    attempt++

    if (attempt < maxAttempts) {
      printPhase(phase.id, `Retrying (${attempt}/${config.maxRetries}) — ${verdict.summary}`)
    }
  }

  return handleExhaustion(config, phase, state, attempt, startTime, checkpointTag)
}
