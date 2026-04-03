import { RidgelineConfig } from "../types"
import { printInfo, printError } from "../ui/output"
import { detectSandbox } from "../engine/claude/sandbox"
import { scanPhases } from "../store/phases"
import { runPhase } from "../engine/pipeline/phase.sequence"
import { loadState, saveState, initState, getNextIncompletePhase, resetRetries } from "../store/state"
import { loadBudget } from "../store/budget"
import { cleanupBuildTags } from "../store/tags"
import { runPlan } from "./plan"

const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`
}

const printSummaryTable = (config: RidgelineConfig, completed: number, failed: number, totalPhases: number, durationMs: number): void => {
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

  console.log("")
  printInfo("=" .repeat(60))
  printInfo(`Build: ${config.buildName}`)
  printInfo(`Phases: ${completed} passed, ${failed} failed, ${totalPhases} total`)
  printInfo(`Duration: ${formatDuration(durationMs)}`)
  printInfo(`Total cost: $${budget.totalCostUsd.toFixed(2)}`)
  printInfo("=" .repeat(60))

  if (phaseStats.size > 0) {
    // Table header
    console.log("")
    const header = "  Phase                    Attempts   Build     Review    Cost"
    const divider = "  " + "-".repeat(header.length - 2)
    console.log(header)
    console.log(divider)

    for (const [phaseId, stats] of phaseStats) {
      const name = phaseId.padEnd(24)
      const attempts = String(stats.attempts).padStart(4)
      const buildTime = formatDuration(stats.buildTime).padStart(8)
      const reviewTime = formatDuration(stats.reviewTime).padStart(8)
      const cost = `$${stats.cost.toFixed(2)}`.padStart(8)
      console.log(`  ${name} ${attempts}   ${buildTime}  ${reviewTime}  ${cost}`)
    }

    if (planCost > 0) {
      const divider2 = "  " + "-".repeat(header.length - 2)
      console.log(divider2)
      console.log(`  ${"Planning".padEnd(24)}            ${"".padStart(8)}  ${"".padStart(8)}  ${`$${planCost.toFixed(2)}`.padStart(8)}`)
    }
  }
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
    const provider = detectSandbox()
    config.sandboxProvider = provider
    if (provider) {
      printInfo(`Sandbox: ${provider.name}`)
    } else {
      printInfo("Warning: no sandbox available (install greywall or bwrap)")
    }
  }

  const startTime = Date.now()
  let completed = 0
  let failed = 0

  printInfo(`Starting build: ${config.buildName} (${phases.length} phases)\n`)

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
  const duration = Date.now() - startTime
  const totalCompleted = state.phases.filter((p) => p.status === "complete").length
  printSummaryTable(config, totalCompleted, failed, phases.length, duration)

  if (failed > 0) {
    process.exit(1)
  }

  if (totalCompleted === phases.length) {
    console.log("")
    printInfo("All phases complete!")
    printInfo("Cleaning up...")
    cleanupBuildTags(config.buildName)
  }
}
