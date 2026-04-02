import * as fs from "node:fs"
import { RidgelineConfig, PhaseInfo } from "../types"
import { logInfo, logError } from "../logging"
import { scanPhases } from "../runner/planInvoker"
import { runPhase } from "../runner/phaseRunner"
import { loadState, saveState, initState, getNextIncompletePhase } from "../state/stateManager"
import { getTotalCost } from "../state/budget"
import { runPlan } from "./plan"

export const runBuild = async (config: RidgelineConfig): Promise<void> => {
  let phases = scanPhases(config.phasesDir)

  // Plan if no phases exist
  if (phases.length === 0) {
    logInfo("No phases found. Running planner first...\n")
    await runPlan(config)
    phases = scanPhases(config.phasesDir)
  }

  if (phases.length === 0) {
    throw new Error("No phases generated")
  }

  // Load or init state
  let state = loadState(config.buildDir)
  if (!state) {
    state = initState(config.buildName, phases)
    saveState(config.buildDir, state)
  }

  const startTime = Date.now()
  let completed = 0
  let failed = 0

  logInfo(`Starting build: ${config.buildName} (${phases.length} phases)\n`)

  // Run phases
  let nextPhaseState = getNextIncompletePhase(state)
  while (nextPhaseState) {
    const phase = phases.find((p) => p.id === nextPhaseState!.id)
    if (!phase) {
      logError(`Phase ${nextPhaseState.id} not found in filesystem`)
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
      const totalCost = getTotalCost(config.buildDir)
      if (totalCost > config.maxBudgetUsd) {
        logInfo(`Budget limit reached: $${totalCost.toFixed(2)} > $${config.maxBudgetUsd}`)
        break
      }
    }

    nextPhaseState = getNextIncompletePhase(state)
  }

  // Summary
  const duration = Date.now() - startTime
  const totalCost = getTotalCost(config.buildDir)

  console.log("")
  logInfo("=" .repeat(40))
  logInfo(`Build: ${config.buildName}`)
  logInfo(`Phases completed: ${completed}/${phases.length}`)
  if (failed > 0) logInfo(`Phases failed: ${failed}`)
  logInfo(`Duration: ${(duration / 1000 / 60).toFixed(1)} minutes`)
  logInfo(`Total cost: $${totalCost.toFixed(2)}`)
  logInfo("=".repeat(40))

  if (failed > 0) {
    logInfo("\nCleanup: git tag -l 'ridgeline/*' | xargs git tag -d")
    process.exit(1)
  }

  if (completed === phases.length) {
    logInfo("\nAll phases complete!")
    logInfo("Cleanup: git tag -l 'ridgeline/*' | xargs git tag -d")
  }
}
