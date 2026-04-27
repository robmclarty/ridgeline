import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig } from "../types"
import { printInfo, printWarn } from "../ui/output"
import { logTrajectory } from "../stores/trajectory"
import { recordCost } from "../stores/budget"
import { invokePlanner } from "../engine/pipeline/ensemble.exec"
import { runPlanReviewer, revisePlanWithFeedback, reportPhaseSizeWarnings } from "../engine/pipeline/plan.review"
import { advancePipeline } from "../stores/state"

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
  logTrajectory(config.buildDir, "plan_start", null, "Planning started")

  const { phases, ensemble } = await invokePlanner(config)

  // Record costs for each specialist
  for (let i = 0; i < ensemble.specialistResults.length; i++) {
    recordCost(config.buildDir, "plan", "specialist", i, ensemble.specialistResults[i])
  }
  recordCost(config.buildDir, "plan", "synthesizer", 0, ensemble.synthesizerResult)

  logTrajectory(config.buildDir, "plan_complete", null, `Generated ${phases.length} phases`, {
    duration: ensemble.totalDurationMs,
    tokens: {
      input: ensemble.specialistResults.reduce((sum, r) => sum + r.usage.inputTokens, 0) + ensemble.synthesizerResult.usage.inputTokens,
      output: ensemble.specialistResults.reduce((sum, r) => sum + r.usage.outputTokens, 0) + ensemble.synthesizerResult.usage.outputTokens,
    },
    costUsd: ensemble.totalCostUsd,
  })

  // Adversarial plan review — catch problems before any phase burns budget.
  let phasesAfterReview = phases
  try {
    const { verdict, result: reviewerResult } = await runPlanReviewer(config)
    recordCost(config.buildDir, "plan", "synthesizer", 1, reviewerResult)
    if (verdict.approved) {
      printInfo(`Plan reviewer: approved (${phases.length} phases)`)
    } else {
      printWarn(`Plan reviewer rejected the plan with ${verdict.issues.length} issue(s):`)
      for (const issue of verdict.issues) {
        printWarn(`  - ${issue}`)
      }
      const revisionResult = await revisePlanWithFeedback(config, verdict.issues)
      recordCost(config.buildDir, "plan", "synthesizer", 2, revisionResult)
      // Re-scan phases after the revision rewrote them.
      const { scanPhases } = await import("../stores/phases")
      phasesAfterReview = scanPhases(config.phasesDir)
      printInfo(`Plan revised: ${phasesAfterReview.length} phases (one-shot revision; not re-reviewed).`)
    }
  } catch (err) {
    printWarn(`Plan reviewer failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
  }

  // Soft per-phase size warning — deterministic, advisory only.
  reportPhaseSizeWarnings(config)

  // Advance pipeline state
  advancePipeline(config.buildDir, config.buildName, "plan")

  // Print summary
  printInfo(`\nPlan complete: ${phasesAfterReview.length} phases generated\n`)
  for (const phase of phasesAfterReview) {
    const content = fs.readFileSync(phase.filepath, "utf-8")
    const titleMatch = content.match(/^#\s+(.+)/m)
    const title = titleMatch ? titleMatch[1] : phase.id
    printInfo(`  ${phase.id}: ${title}`)
  }
  printInfo(`\nCost: $${ensemble.totalCostUsd.toFixed(2)} (${ensemble.specialistResults.length} specialists + synthesizer)`)
  printInfo(`\nNext: ridgeline dry-run ${config.buildName}`)
}
