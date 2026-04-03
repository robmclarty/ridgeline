import * as fs from "node:fs"
import { RidgelineConfig } from "../types"
import { logInfo } from "../logging"
import { scanPhases } from "../state/phases"
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

    // Parse phase title
    const titleMatch = content.match(/^#\s+(.+)/m)
    const title = titleMatch ? titleMatch[1] : phase.id

    // Parse goal section
    const goalMatch = content.match(/## Goal\s*\n([\s\S]*?)(?=\n## |\n$)/)
    const goal = goalMatch ? goalMatch[1].trim() : ""

    // Parse acceptance criteria
    const criteriaMatch = content.match(/## Acceptance Criteria\s*\n([\s\S]*?)(?=\n## |\n$)/)
    const criteria = criteriaMatch ? criteriaMatch[1].trim() : ""

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
