import * as fs from "node:fs"
import { RidgelineConfig } from "../types"
import { logInfo } from "../logging"
import { scanPhases, parsePhaseContent } from "../store/phases"
import { runPlan } from "./plan"

export const runDryRun = async (config: RidgelineConfig): Promise<void> => {
  let phases = scanPhases(config.phasesDir)

  if (phases.length === 0) {
    logInfo("No phases found. Running planner first...\n")
    await runPlan(config)
    phases = scanPhases(config.phasesDir)
  }

  if (phases.length === 0) {
    throw new Error("No phases generated")
  }

  console.log(`\n${"=".repeat(60)}`)
  console.log(`  Build: ${config.buildName}`)
  console.log(`  Phases: ${phases.length}`)
  console.log(`  Model: ${config.model}`)
  console.log(`  Max retries: ${config.maxRetries}`)
  console.log(`${"=".repeat(60)}\n`)

  for (const phase of phases) {
    const content = fs.readFileSync(phase.filepath, "utf-8")

    const { title: parsedTitle, goal, criteria } = parsePhaseContent(content)
    const title = parsedTitle || phase.id

    console.log(`--- ${title} ---`)
    if (goal) {
      console.log(`\nGoal: ${goal.split("\n")[0]}`)
    }
    if (criteria) {
      console.log(`\nAcceptance Criteria:`)
      console.log(criteria)
    }
    console.log("")
  }

  logInfo(`Review the phases above. To execute: ridgeline run ${config.buildName}`)
}
