import { RidgelineConfig } from "../types"
import { printInfo, printError, printPhaseHeader } from "../ui/output"
import { detectSandbox } from "../engine/claude/sandbox"
import { scanPhases } from "../stores/phases"
import { runPhase } from "../engine/pipeline/phase.sequence"
import { loadState, saveState, initState, getNextIncompletePhase, resetRetries, markBuildRunning, advancePipeline } from "../stores/state"
import { loadBudget } from "../stores/budget"
import { cleanupBuildTags } from "../stores/tags"
import { killAllClaudeSync } from "../engine/claude/claude.exec"
import { runPlan } from "./plan"
import { ensureGitRepo } from "../engine/worktree"
import * as fs from "node:fs"
import * as path from "node:path"

const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return remaining > 0 ? `${minutes}m ${remaining.toString().padStart(2, "0")}s` : `${minutes}m`
}

const readSpecDescription = (buildDir: string): string | null => {
  const specPath = path.join(buildDir, "..", "spec.md")
  try {
    const content = fs.readFileSync(specPath, "utf-8")
    const match = content.match(/^#\s+(.+)/m)
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}

const formatTokens = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

const printSummaryTable = (config: RidgelineConfig): void => {
  const budget = loadBudget(config.buildDir)

  // Build per-phase stats from budget entries
  const phaseStats = new Map<string, { cost: number; buildTime: number; reviewTime: number; attempts: number }>()
  for (const entry of budget.entries) {
    if (entry.phase === "plan") continue
    let stats = phaseStats.get(entry.phase)
    if (!stats) {
      stats = { cost: 0, buildTime: 0, reviewTime: 0, attempts: 0 }
      phaseStats.set(entry.phase, stats)
    }
    stats.cost += entry.costUsd
    if (entry.role === "builder") {
      stats.buildTime += entry.durationMs
      stats.attempts++
    } else if (entry.role === "reviewer") {
      stats.reviewTime += entry.durationMs
    }
  }

  // Planning cost
  const planCost = budget.entries
    .filter((e) => e.phase === "plan")
    .reduce((sum, e) => sum + e.costUsd, 0)

  // Totals
  let totalAttempts = 0
  let totalBuildTime = 0
  let totalReviewTime = 0
  let totalCost = planCost
  let totalInputTokens = 0
  let totalOutputTokens = 0
  for (const entry of budget.entries) {
    totalInputTokens += entry.inputTokens
    totalOutputTokens += entry.outputTokens
  }
  for (const stats of phaseStats.values()) {
    totalAttempts += stats.attempts
    totalBuildTime += stats.buildTime
    totalReviewTime += stats.reviewTime
    totalCost += stats.cost
  }

  // Wall-clock elapsed time
  const timestamps = budget.entries.map((e) => e.timestamp).filter(Boolean)
  const elapsed = timestamps.length >= 2
    ? new Date(timestamps[timestamps.length - 1]).getTime() - new Date(timestamps[0]).getTime()
    : 0

  const sep = "  " + "=".repeat(65)
  const div = "  " + "-".repeat(65)

  // Header
  console.log("")
  console.log(sep)
  console.log(`  Build: ${config.buildName}`)
  const description = readSpecDescription(config.buildDir)
  if (description) {
    console.log(`  ${description}`)
  }
  console.log(sep)

  // Breakdown table
  const formatRow = (name: string, attempts: string, build: string, review: string, cost: string): string =>
    `  ${name.padEnd(24)} ${attempts.padStart(8)}  ${build.padStart(8)}  ${review.padStart(8)}    ${cost.padStart(8)}`

  console.log("")
  console.log(formatRow("", "Attempts", "Build", "Review", "Cost"))
  console.log(div)

  // Planning row
  console.log(formatRow("Planning", "", "", "", `$${planCost.toFixed(2)}`))
  console.log(div)

  // Per-phase rows
  for (const [phaseId, stats] of phaseStats) {
    console.log(formatRow(
      phaseId,
      String(stats.attempts),
      formatDuration(stats.buildTime),
      formatDuration(stats.reviewTime),
      `$${stats.cost.toFixed(2)}`,
    ))
  }
  console.log(div)

  // Total row
  console.log(formatRow(
    "Total",
    String(totalAttempts),
    formatDuration(totalBuildTime),
    formatDuration(totalReviewTime),
    `$${totalCost.toFixed(2)}`,
  ))

  // Footer stats
  console.log("")
  const footerParts = [`  Tokens: ${formatTokens(totalInputTokens)} in / ${formatTokens(totalOutputTokens)} out`]
  if (elapsed > 0) {
    footerParts.push(`Elapsed: ${formatDuration(elapsed)}`)
  }
  console.log(footerParts.join("  ·  "))
}

export const ensurePhases = async (config: RidgelineConfig) => {
  let phases = scanPhases(config.phasesDir)
  if (phases.length === 0) {
    printInfo("No phases found. Running planner first...\n")
    await runPlan(config)
    phases = scanPhases(config.phasesDir)
  }
  if (phases.length === 0) {
    throw new Error("No phases generated")
  }
  return phases
}

const configureSandbox = (config: RidgelineConfig): void => {
  if (config.unsafe) return
  const { provider, warning } = detectSandbox()
  config.sandboxProvider = provider
  if (warning) {
    printInfo(`Warning: ${warning}`)
  } else if (provider) {
    printInfo(`Sandbox: ${provider.name}`)
  } else {
    printInfo("Warning: no sandbox available (install greywall or bwrap)")
  }
}

export const runBuild = async (config: RidgelineConfig): Promise<void> => {
  const phases = await ensurePhases(config)

  // Load or init state
  let state = loadState(config.buildDir)
  const isResume = state !== null && state.phases.length > 0
  if (!state || state.phases.length === 0) {
    const pipeline = state?.pipeline
    state = initState(config.buildName, phases)
    if (pipeline) state.pipeline = pipeline
    saveState(config.buildDir, state)
  }

  if (isResume) {
    resetRetries(config.buildDir, state)
    const completedCount = state.phases.filter((p) => p.status === "complete").length
    printInfo(`Resuming build '${config.buildName}' from phase ${completedCount + 1}/${state.phases.length}`)
  }

  configureSandbox(config)

  markBuildRunning(config.buildDir, config.buildName)
  printInfo(`Starting build: ${config.buildName} (${phases.length} phases)\n`)

  if (ensureGitRepo(process.cwd())) {
    printInfo("Initialised git repo with initial commit")
  }

  let completed = 0
  let failed = 0

  try {
    let nextPhaseState = getNextIncompletePhase(state)
    while (nextPhaseState) {
      const phase = phases.find((p) => p.id === nextPhaseState!.id)
      if (!phase) {
        printError(`Phase ${nextPhaseState.id} not found in filesystem`)
        failed++
        break
      }

      const phaseIndex = phases.findIndex((p) => p.id === nextPhaseState!.id) + 1
      printPhaseHeader(phaseIndex, phases.length, phase.id)

      const result = await runPhase(phase, config, state)
      if (result !== "passed") { failed++; break }

      completed++

      if (config.maxBudgetUsd) {
        const budget = loadBudget(config.buildDir)
        if (budget.totalCostUsd > config.maxBudgetUsd) {
          printInfo(`Budget limit reached: $${budget.totalCostUsd.toFixed(2)} > $${config.maxBudgetUsd}`)
          break
        }
      }

      nextPhaseState = getNextIncompletePhase(state)
    }

  } catch (err) {
    printError(`Unexpected error: ${err instanceof Error ? err.message : err}`)
    failed++
  }

  // Summary — always printed, even on failure
  printSummaryTable(config)

  if (failed > 0) {
    killAllClaudeSync()
    process.exit(1)
  }

  const isFullyDone = state.phases.every((p) => p.status === "complete")

  if (isFullyDone) {
    advancePipeline(config.buildDir, config.buildName, "build")
    console.log("")
    console.log("  All phases complete!")
    cleanupBuildTags(config.buildName)
  }
}
