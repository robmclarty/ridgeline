import * as fs from "node:fs"
import { RidgelineConfig } from "../types.js"
import { printInfo } from "../ui/output.js"
import { parsePhaseContent } from "../stores/phases.js"
import { ensurePhases } from "./build.js"

export const runDryRun = async (config: RidgelineConfig): Promise<void> => {
  const phases = await ensurePhases(config)

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

  printInfo(`Review the phases above. To execute: ridgeline build ${config.buildName}`)
}
