import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig } from "../types"
import { printInfo } from "../ui/output"
import { logTrajectory, makeTrajectoryEntry } from "../store/trajectory"
import { recordCost } from "../store/budget"
import { invokePlanner } from "../engine/pipeline/ensemble.exec"
import { advancePipeline } from "../store/state"

export const runPlan = async (config: RidgelineConfig): Promise<void> => {
  const specPath = path.join(config.buildDir, "spec.md")
  if (!fs.existsSync(specPath)) {
    throw new Error(`spec.md not found at ${specPath}. Run 'ridgeline init ${config.buildName}' first.`)
  }
  if (!fs.existsSync(config.constraintsPath)) {
    throw new Error(`constraints.md not found at ${config.constraintsPath}`)
  }

  // Create phases directory
  fs.mkdirSync(config.phasesDir, { recursive: true })

  // Run planner
  printInfo("Running planner...")
  logTrajectory(config.buildDir, makeTrajectoryEntry("plan_start", null, "Planning started"))

  const { phases, ensemble } = await invokePlanner(config)

  // Record costs for each specialist
  for (let i = 0; i < ensemble.specialistResults.length; i++) {
    recordCost(config.buildDir, "plan", "specialist", i, ensemble.specialistResults[i])
  }
  recordCost(config.buildDir, "plan", "synthesizer", 0, ensemble.synthesizerResult)

  logTrajectory(config.buildDir, makeTrajectoryEntry(
    "plan_complete", null, `Generated ${phases.length} phases`,
    {
      duration: ensemble.totalDurationMs,
      tokens: {
        input: ensemble.specialistResults.reduce((sum, r) => sum + r.usage.inputTokens, 0) + ensemble.synthesizerResult.usage.inputTokens,
        output: ensemble.specialistResults.reduce((sum, r) => sum + r.usage.outputTokens, 0) + ensemble.synthesizerResult.usage.outputTokens,
      },
      costUsd: ensemble.totalCostUsd,
    }
  ))

  // Advance pipeline state
  advancePipeline(config.buildDir, config.buildName, "plan")

  // Print summary
  printInfo(`\nPlan complete: ${phases.length} phases generated\n`)
  for (const phase of phases) {
    const content = fs.readFileSync(phase.filepath, "utf-8")
    const titleMatch = content.match(/^#\s+(.+)/m)
    const title = titleMatch ? titleMatch[1] : phase.id
    printInfo(`  ${phase.id}: ${title}`)
  }
  printInfo(`\nCost: $${ensemble.totalCostUsd.toFixed(2)} (${ensemble.specialistResults.length} specialists + synthesizer)`)
  printInfo(`\nNext: ridgeline dry-run ${config.buildName}`)
}
