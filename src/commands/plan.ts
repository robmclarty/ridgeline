import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig } from "../types"
import { logInfo } from "../logging"
import { logTrajectory, makeTrajectoryEntry } from "../store/trajectory"
import { recordCost } from "../store/budget"
import { invokePlanner } from "../engine/planInvoker"

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
  logInfo("Running planner...")
  logTrajectory(config.buildDir, makeTrajectoryEntry("plan_start", null, "Planning started"))

  const { result, phases } = await invokePlanner(config)

  logTrajectory(config.buildDir, makeTrajectoryEntry(
    "plan_complete", null, `Generated ${phases.length} phases`,
    {
      duration: result.durationMs,
      tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens },
      costUsd: result.costUsd,
    }
  ))

  recordCost(config.buildDir, "plan", "planner", 0, result)

  // Print summary
  logInfo(`\nPlan complete: ${phases.length} phases generated\n`)
  for (const phase of phases) {
    const content = fs.readFileSync(phase.filepath, "utf-8")
    const titleMatch = content.match(/^#\s+(.+)/m)
    const title = titleMatch ? titleMatch[1] : phase.id
    logInfo(`  ${phase.id}: ${title}`)
  }
  logInfo(`\nCost: $${result.costUsd.toFixed(2)}`)
  logInfo(`\nNext: ridgeline dry-run ${config.buildName}`)
}
