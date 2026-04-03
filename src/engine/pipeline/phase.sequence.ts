import { RidgelineConfig, PhaseInfo, BuildState } from "../../types"
import { createCheckpoint, createCompletionTag } from "../../store/tags"
import { recordCost } from "../../store/budget"
import { ensureHandoffExists } from "../../store/handoff"
import { formatIssue, writeFeedback, archiveFeedback } from "../../store/feedback"
import { logTrajectory, makeTrajectoryEntry } from "../../store/trajectory"
import { updatePhaseStatus } from "../../store/state"
import { printPhase } from "../../ui/output"
import { invokeBuilder } from "./build.exec"
import { invokeReviewer } from "./review.exec"

export const runPhase = async (
  phase: PhaseInfo,
  config: RidgelineConfig,
  state: BuildState
): Promise<"passed" | "failed"> => {
  const phaseState = state.phases.find((p) => p.id === phase.id)
  if (!phaseState) throw new Error(`Phase ${phase.id} not found in state`)

  const checkpointTag = phaseState.checkpointTag
  const startTime = Date.now()

  // Pre-phase: create git checkpoint
  createCheckpoint(checkpointTag, phase.id)

  ensureHandoffExists(config.buildDir)

  let attempt = phaseState.retries
  const maxAttempts = config.maxRetries + 1 // retries + initial attempt
  const sandboxNote = config.sandboxProvider ? ` [sandbox: ${config.sandboxProvider.name}]` : ""

  while (attempt < maxAttempts) {
    const isRetry = attempt > 0
    const feedbackFilePath = isRetry
      ? phase.filepath.replace(/\.md$/, ".feedback.md")
      : null

    // Build
    printPhase(phase.id, isRetry ? `Retry ${attempt}: building...` : "Building...")
    logTrajectory(config.buildDir, makeTrajectoryEntry("build_start", phase.id, `Build attempt ${attempt + 1}${sandboxNote}`))

    let buildResult
    try {
      buildResult = await invokeBuilder(config, phase, feedbackFilePath)
    } catch (err) {
      printPhase(phase.id, `Build failed: ${err}`)
      logTrajectory(config.buildDir, makeTrajectoryEntry("build_complete", phase.id, `Build error: ${err}`))
      attempt++
      continue
    }

    logTrajectory(config.buildDir, makeTrajectoryEntry(
      "build_complete", phase.id, "Build complete",
      {
        duration: buildResult.durationMs,
        tokens: { input: buildResult.usage.inputTokens, output: buildResult.usage.outputTokens },
        costUsd: buildResult.costUsd,
      }
    ))

    const budget = recordCost(config.buildDir, phase.id, "builder", attempt, buildResult)

    // Budget check
    if (config.maxBudgetUsd && budget.totalCostUsd > config.maxBudgetUsd) {
      printPhase(phase.id, `Budget exceeded: $${budget.totalCostUsd.toFixed(2)} > $${config.maxBudgetUsd}`)
      logTrajectory(config.buildDir, makeTrajectoryEntry(
        "budget_exceeded", phase.id,
        `Total cost $${budget.totalCostUsd.toFixed(2)} exceeds budget $${config.maxBudgetUsd}`
      ))
      updatePhaseStatus(config.buildDir, state, phase.id, { status: "failed", failedAt: new Date().toISOString() })
      return "failed"
    }

    // Review
    printPhase(phase.id, "Reviewing...")
    updatePhaseStatus(config.buildDir, state, phase.id, { status: "reviewing" })
    logTrajectory(config.buildDir, makeTrajectoryEntry("review_start", phase.id, `Review attempt ${attempt + 1}${sandboxNote}`))

    let reviewResult
    try {
      reviewResult = await invokeReviewer(config, phase, checkpointTag)
    } catch (err) {
      printPhase(phase.id, `Review failed: ${err}`)
      logTrajectory(config.buildDir, makeTrajectoryEntry("review_complete", phase.id, `Review error: ${err}`))
      attempt++
      continue
    }

    const { result: reviewClaudeResult, verdict } = reviewResult

    logTrajectory(config.buildDir, makeTrajectoryEntry(
      "review_complete", phase.id, verdict.summary,
      {
        duration: reviewClaudeResult.durationMs,
        tokens: { input: reviewClaudeResult.usage.inputTokens, output: reviewClaudeResult.usage.outputTokens },
        costUsd: reviewClaudeResult.costUsd,
      }
    ))

    recordCost(config.buildDir, phase.id, "reviewer", attempt, reviewClaudeResult)

    // Verdict handling
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
      logTrajectory(config.buildDir, makeTrajectoryEntry("phase_advance", phase.id, "Phase passed"))
      return "passed"
    }

    // Failed — write feedback for builder retry
    printPhase(phase.id, `FAILED: ${verdict.summary}`)
    for (const issue of verdict.issues) {
      printPhase(phase.id, `  - ${formatIssue(issue)}`)
    }

    // Keep numbered feedback files for post-build analysis
    archiveFeedback(phase.filepath, phase.id, verdict, attempt)

    // Write the latest feedback for the builder to read on retry
    writeFeedback(phase.filepath, phase.id, verdict)

    attempt++

    if (attempt < maxAttempts) {
      printPhase(phase.id, `Retrying (${attempt}/${config.maxRetries})...`)
    }
  }

  // Retries exhausted
  const duration = Date.now() - startTime
  updatePhaseStatus(config.buildDir, state, phase.id, {
    status: "failed",
    retries: attempt,
    duration,
    failedAt: new Date().toISOString(),
  })

  printPhase(phase.id, "FAILED: retries exhausted")
  logTrajectory(config.buildDir, makeTrajectoryEntry("phase_fail", phase.id, "Retries exhausted"))

  console.log("")
  console.log(`Recovery: git reset --hard ${checkpointTag}`)
  console.log("Options:")
  console.log("  1. Edit spec.md and re-run: ridgeline plan <build> && ridgeline build <build>")
  console.log(`  2. Edit the phase spec directly: ${phase.filepath}`)
  console.log(`  3. Resume after manual fixes: ridgeline build ${config.buildName}`)

  return "failed"
}
