import { RidgelineConfig } from "../types"
import { printInfo, printError } from "../ui/output"
import { detectSandbox } from "../engine/claude/sandbox"
import { scanPhases } from "../store/phases"
import { runPhase } from "../engine/pipeline/phase.sequence"
import { loadState, saveState, initState, getNextIncompletePhase, resetRetries } from "../store/state"
import { loadBudget } from "../store/budget"
import { cleanupBuildTags } from "../store/tags"
import { commitAll, isWorkingTreeDirty } from "../git"
import { runPlan } from "./plan"
import {
  createWorktree,
  validateWorktree,
  reflectCommits,
  removeWorktree,
  worktreePath as getWorktreePath,
  ensureGitRepo,
} from "../engine/worktree"
import * as fs from "node:fs"
import * as path from "node:path"

const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`
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

const printSummaryTable = (config: RidgelineConfig, completed: number, failed: number, totalPhases: number): void => {
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
  for (const stats of phaseStats.values()) {
    totalAttempts += stats.attempts
    totalBuildTime += stats.buildTime
    totalReviewTime += stats.reviewTime
    totalCost += stats.cost
  }

  const sep = "  " + "=".repeat(60)
  const div = "  " + "-".repeat(60)

  // Header
  console.log("")
  console.log(sep)
  console.log(`  Build: ${config.buildName}`)
  const description = readSpecDescription(config.buildDir)
  if (description) {
    console.log(`  ${description}`)
  }
  console.log(`  Phases: ${completed} passed, ${failed} failed, ${totalPhases} total`)
  console.log(sep)

  // Breakdown table
  const formatRow = (name: string, attempts: string, build: string, review: string, cost: string): string =>
    `  ${name.padEnd(24)}   ${attempts.padStart(4)}  ${build.padStart(8)}  ${review.padStart(8)}    ${cost.padStart(8)}`

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
}

export const runBuild = async (config: RidgelineConfig): Promise<void> => {
  let phases = scanPhases(config.phasesDir)

  // Plan if no phases exist
  if (phases.length === 0) {
    printInfo("No phases found. Running planner first...\n")
    await runPlan(config)
    phases = scanPhases(config.phasesDir)
  }

  if (phases.length === 0) {
    throw new Error("No phases generated")
  }

  // Load or init state
  let state = loadState(config.buildDir)
  const isResume = state !== null
  if (!state) {
    state = initState(config.buildName, phases)
    saveState(config.buildDir, state)
  }

  // On resume: reset retries for incomplete phases so they get full attempts
  if (isResume) {
    resetRetries(config.buildDir, state)
    const completedCount = state.phases.filter((p) => p.status === "complete").length
    printInfo(`Resuming build '${config.buildName}' from phase ${completedCount + 1}/${state.phases.length}`)
  }

  // Validate sandbox availability before starting phases
  if (!config.unsafe) {
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

  let completed = 0
  let failed = 0

  printInfo(`Starting build: ${config.buildName} (${phases.length} phases)\n`)

  // Ensure we're in a git repo with at least one commit (needed for worktrees)
  const repoRoot = process.cwd()
  if (ensureGitRepo(repoRoot)) {
    printInfo("Initialised git repo with initial commit")
  }

  // Set up worktree
  if (validateWorktree(repoRoot, config.buildName)) {
    config.worktreePath = getWorktreePath(repoRoot, config.buildName)
    printInfo(`Resuming in worktree: ${config.worktreePath}`)
  } else {
    // Clean up broken worktree if it exists
    const existingPath = getWorktreePath(repoRoot, config.buildName)
    if (fs.existsSync(existingPath)) {
      removeWorktree(repoRoot, config.buildName)
    }
    config.worktreePath = createWorktree(repoRoot, config.buildName)
    printInfo(`Worktree: ${config.worktreePath}`)
  }

  // Run phases
  let nextPhaseState = getNextIncompletePhase(state)
  while (nextPhaseState) {
    const phase = phases.find((p) => p.id === nextPhaseState!.id)
    if (!phase) {
      printError(`Phase ${nextPhaseState.id} not found in filesystem`)
      failed++
      break
    }

    const result = await runPhase(phase, config, state)

    if (result === "passed") {
      completed++
      // Commit any uncommitted work in the worktree before merging
      // (the sandbox prevents the builder from committing directly)
      if (config.worktreePath && isWorkingTreeDirty(config.worktreePath)) {
        commitAll(`ridgeline: ${phase.id}`, config.worktreePath)
      }
      reflectCommits(repoRoot, config.buildName)
    } else {
      failed++
      break // Halt on failure
    }

    // Budget check after phase
    if (config.maxBudgetUsd) {
      const budget = loadBudget(config.buildDir)
      if (budget.totalCostUsd > config.maxBudgetUsd) {
        printInfo(`Budget limit reached: $${budget.totalCostUsd.toFixed(2)} > $${config.maxBudgetUsd}`)
        break
      }
    }

    nextPhaseState = getNextIncompletePhase(state)
  }

  // Summary
  const totalCompleted = state.phases.filter((p) => p.status === "complete").length
  printSummaryTable(config, totalCompleted, failed, phases.length)

  if (failed > 0) {
    process.exit(1)
  }

  if (totalCompleted === phases.length) {
    console.log("")
    console.log("  All phases complete!")
    console.log("  Cleaning up...")
    cleanupBuildTags(config.buildName)
    removeWorktree(repoRoot, config.buildName)
  }
}
