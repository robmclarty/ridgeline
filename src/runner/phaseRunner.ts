import { execSync } from "node:child_process"
import { RidgelineConfig, PhaseInfo, BuildState } from "../types"
import { createTag, isWorkingTreeDirty, commitAll } from "../git"
import { recordCost } from "../state/budget"
import { ensureHandoffExists } from "../state/handoff"
import { updatePhaseStatus } from "../state/stateManager"
import { logPhase, logTrajectory, makeTrajectoryEntry } from "../logging"
import { invokeBuilder } from "./buildInvoker"
import { invokeEvaluator } from "./evalInvoker"

const runCheckCommand = (
  checkCommand: string | null
): { command: string; output: string; exitCode: number } | null => {
  if (!checkCommand) return null
  try {
    const output = execSync(checkCommand, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    })
    return { command: checkCommand, output, exitCode: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number }
    return {
      command: checkCommand,
      output: (e.stdout ?? "") + (e.stderr ?? ""),
      exitCode: e.status ?? 1,
    }
  }
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

  // Pre-phase: create git checkpoint
  if (isWorkingTreeDirty()) {
    commitAll(`chore: pre-phase checkpoint for ${phase.id}`)
  }
  createTag(checkpointTag)

  ensureHandoffExists(config.buildDir)

  let attempt = phaseState.retries
  const maxAttempts = config.maxRetries + 1 // retries + initial attempt

  while (attempt < maxAttempts) {
    const isRetry = attempt > 0
    const feedbackPath = isRetry
      ? phase.filepath.replace(/\.md$/, ".feedback.md")
      : null

    // Build
    logPhase(phase.id, isRetry ? `Retry ${attempt}: building...` : "Building...")
    updatePhaseStatus(config.buildDir, state, phase.id, { status: "building", retries: attempt })
    logTrajectory(config.buildDir, makeTrajectoryEntry("build_start", phase.id, `Build attempt ${attempt + 1}`))

    let buildResult
    try {
      buildResult = await invokeBuilder(config, phase, feedbackPath)
    } catch (err) {
      logPhase(phase.id, `Build failed: ${err}`)
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
      logPhase(phase.id, `Budget exceeded: $${budget.totalCostUsd.toFixed(2)} > $${config.maxBudgetUsd}`)
      logTrajectory(config.buildDir, makeTrajectoryEntry(
        "budget_exceeded", phase.id,
        `Total cost $${budget.totalCostUsd.toFixed(2)} exceeds budget $${config.maxBudgetUsd}`
      ))
      updatePhaseStatus(config.buildDir, state, phase.id, { status: "failed", failedAt: new Date().toISOString() })
      return "failed"
    }

    // Run check command
    const checkOutput = runCheckCommand(config.checkCommand)

    // Evaluate
    logPhase(phase.id, "Evaluating...")
    updatePhaseStatus(config.buildDir, state, phase.id, { status: "evaluating" })
    logTrajectory(config.buildDir, makeTrajectoryEntry("eval_start", phase.id, `Evaluation attempt ${attempt + 1}`))

    let evalResult
    try {
      evalResult = await invokeEvaluator(config, phase, checkpointTag, checkOutput)
    } catch (err) {
      logPhase(phase.id, `Evaluation failed: ${err}`)
      logTrajectory(config.buildDir, makeTrajectoryEntry("eval_complete", phase.id, `Eval error: ${err}`))
      attempt++
      continue
    }

    const { result: evalClaudeResult, verdict } = evalResult

    logTrajectory(config.buildDir, makeTrajectoryEntry(
      "eval_complete", phase.id, verdict.summary,
      {
        duration: evalClaudeResult.durationMs,
        tokens: { input: evalClaudeResult.usage.inputTokens, output: evalClaudeResult.usage.outputTokens },
        costUsd: evalClaudeResult.costUsd,
      }
    ))

    recordCost(config.buildDir, phase.id, "evaluator", attempt, evalClaudeResult)

    // Verdict handling
    if (verdict.passed) {
      const duration = Date.now() - startTime
      const completionTag = `ridgeline/phase/${config.buildName}/${phase.id}`
      createTag(completionTag)

      updatePhaseStatus(config.buildDir, state, phase.id, {
        status: "complete",
        completionTag,
        duration,
        completedAt: new Date().toISOString(),
      })

      logPhase(phase.id, `PASSED (${(duration / 1000).toFixed(0)}s)`)
      logTrajectory(config.buildDir, makeTrajectoryEntry("phase_advance", phase.id, "Phase passed"))
      return "passed"
    }

    // Failed
    logPhase(phase.id, `FAILED: ${verdict.summary}`)
    for (const issue of verdict.issues) {
      logPhase(phase.id, `  - ${issue}`)
    }

    attempt++

    if (attempt < maxAttempts) {
      logPhase(phase.id, `Retrying (${attempt}/${config.maxRetries})...`)
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

  logPhase(phase.id, "FAILED: retries exhausted")
  logTrajectory(config.buildDir, makeTrajectoryEntry("phase_fail", phase.id, "Retries exhausted"))

  console.log("")
  console.log(`Recovery: git reset --hard ${checkpointTag}`)
  console.log("Options:")
  console.log("  1. Edit spec.md and re-run: ridgeline plan <build> && ridgeline run <build>")
  console.log(`  2. Edit the phase spec directly: ${phase.filepath}`)
  console.log(`  3. Resume after manual fixes: ridgeline resume ${config.buildName}`)

  return "failed"
}
