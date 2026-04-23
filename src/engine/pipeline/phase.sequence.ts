import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig, PhaseInfo, BuildState, ClaudeResult, ReviewVerdict } from "../../types"
import { createCheckpoint, createCompletionTag } from "../../stores/tags"
import { recordCost } from "../../stores/budget"
import { ensureHandoffExists, ensurePhaseHandoffExists } from "../../stores/handoff"
import { formatIssue } from "../../stores/feedback.verdict"
import { writeFeedback, archiveFeedback } from "../../stores/feedback.io"
import { logTrajectory } from "../../stores/trajectory"
import { updatePhaseStatus } from "../../stores/state"
import { printPhase, printWarn } from "../../ui/output"
import { commitAll, isWorkingTreeDirty } from "../../git"
import { invokeBuilder } from "./build.exec"
import { invokeReviewer } from "./review.exec"
import { detect } from "../detect"
import { collectSensorFindings } from "./sensors.collect"
import type { SensorFinding } from "../../sensors"

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

const runSensorsForPhase = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  cwd: string,
): Promise<SensorFinding[]> => {
  try {
    const report = await detect(cwd)
    if (report.suggestedSensors.length === 0) return []
    const findings = await collectSensorFindings(report.suggestedSensors, {
      cwd,
      ridgelineDir: config.ridgelineDir,
      buildDir: config.buildDir,
      shapeMdPath: path.join(config.buildDir, "shape.md"),
      model: config.model,
    }, {
      onWarn: (line) => printWarn(line),
    })
    return findings
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    printWarn(`[ridgeline] WARN: sensor pipeline error for ${phase.id}: ${message}`)
    return []
  }
}

const persistSensorFindings = (
  config: RidgelineConfig,
  phase: PhaseInfo,
  findings: SensorFinding[],
): string | null => {
  if (findings.length === 0) return null
  const dir = path.join(config.buildDir, "sensors")
  try {
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${phase.id}.json`)
    fs.writeFileSync(file, JSON.stringify({ phaseId: phase.id, findings }, null, 2))
    return file
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    printWarn(`[ridgeline] WARN: failed to persist sensor findings for ${phase.id}: ${message}`)
    return null
  }
}

const executeBuild = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  state: BuildState,
  attempt: number,
  feedbackFilePath: string | null,
  sandboxNote: string,
  cwd?: string,
): Promise<{ result: ClaudeResult; isBudgetExceeded: boolean; sensorFindings: SensorFinding[] }> => {
  const isRetry = attempt > 0
  printPhase(phase.id, isRetry ? `Retry ${attempt}: building...` : "Building...")
  logTrajectory(config.buildDir, "build_start", phase.id, `Build attempt ${attempt + 1}${sandboxNote}`)

  // In the wave path the builder appends to a per-phase handoff fragment
  // inside the worktree; create it up-front so the file the prompt names exists.
  if (cwd) {
    const wtBuildDir = path.join(cwd, ".ridgeline", "builds", config.buildName)
    ensurePhaseHandoffExists(wtBuildDir, phase.id)
  }

  const wallStart = Date.now()
  const result = await invokeBuilder(config, phase, feedbackFilePath, cwd)
  result.durationMs = Date.now() - wallStart

  logTrajectory(config.buildDir, "build_complete", phase.id, "Build complete", {
    duration: result.durationMs,
    tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens },
    costUsd: result.costUsd,
    cacheReadInputTokens: result.usage.cacheReadInputTokens,
    cacheCreationInputTokens: result.usage.cacheCreationInputTokens,
  })

  const budget = recordCost(config.buildDir, phase.id, "builder", attempt, result)

  // Commit builder work so the reviewer can see the diff
  if (isWorkingTreeDirty(cwd)) {
    commitAll(`ridgeline: builder work for ${phase.id} (attempt ${attempt + 1})`, cwd)
  }

  const sensorFindings = await runSensorsForPhase(config, phase, cwd ?? process.cwd())
  persistSensorFindings(config, phase, sensorFindings)

  return {
    result,
    isBudgetExceeded: isBudgetExceeded(budget.totalCostUsd, config, phase, state),
    sensorFindings,
  }
}

const executeReview = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  state: BuildState,
  attempt: number,
  checkpointTag: string,
  sandboxNote: string,
  cwd?: string,
  sensorFindings?: SensorFinding[],
): Promise<{ result: ClaudeResult; verdict: ReviewVerdict }> => {
  printPhase(phase.id, "Reviewing...")
  updatePhaseStatus(config.buildDir, state, phase.id, { status: "reviewing" })
  logTrajectory(config.buildDir, "review_start", phase.id, `Review attempt ${attempt + 1}${sandboxNote}`)

  const wallStart = Date.now()
  const { result, verdict } = await invokeReviewer(config, phase, checkpointTag, cwd, sensorFindings)
  result.durationMs = Date.now() - wallStart

  logTrajectory(config.buildDir, "review_complete", phase.id, verdict.summary, {
    duration: result.durationMs,
    tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens },
    costUsd: result.costUsd,
    cacheReadInputTokens: result.usage.cacheReadInputTokens,
    cacheCreationInputTokens: result.usage.cacheCreationInputTokens,
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
  state: BuildState,
  cwd?: string,
): Promise<"passed" | "failed"> => {
  const phaseState = state.phases.find((p) => p.id === phase.id)
  if (!phaseState) throw new Error(`Phase ${phase.id} not found in state`)

  const checkpointTag = phaseState.checkpointTag
  const startTime = Date.now()

  createCheckpoint(checkpointTag, phase.id, cwd)
  ensureHandoffExists(config.buildDir)

  let attempt = phaseState.retries
  const maxAttempts = config.maxRetries + 1
  const sandboxNote = config.sandboxProvider ? ` [sandbox: ${config.sandboxProvider.name}]` : ""

  while (attempt < maxAttempts) {
    const feedbackFilePath = attempt > 0
      ? phase.filepath.replace(/\.md$/, ".feedback.md")
      : null

    const retryOrFail = async (err: unknown, label: "build" | "review"): Promise<"fatal" | "retried"> => {
      if (handleInvokeError(err, label, phase, config, state) === "fatal") return "fatal"
      const delay = backoffMs(attempt)
      printPhase(phase.id, `Waiting ${(delay / 1000).toFixed(1)}s before retry...`)
      await sleep(delay)
      attempt++
      return "retried"
    }

    let sensorFindings: SensorFinding[] = []
    try {
      const build = await executeBuild(config, phase, state, attempt, feedbackFilePath, sandboxNote, cwd)
      sensorFindings = build.sensorFindings
      if (build.isBudgetExceeded) return "failed"
    } catch (err) {
      if (await retryOrFail(err, "build") === "fatal") return "failed"
      continue
    }

    let verdict: ReviewVerdict
    try {
      const review = await executeReview(config, phase, state, attempt, checkpointTag, sandboxNote, cwd, sensorFindings)
      verdict = review.verdict
    } catch (err) {
      if (await retryOrFail(err, "review") === "fatal") return "failed"
      continue
    }

    if (verdict.passed) {
      const duration = Date.now() - startTime
      const completionTag = createCompletionTag(config.buildName, phase.id, cwd)

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
