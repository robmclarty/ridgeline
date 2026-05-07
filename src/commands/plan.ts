import * as fs from "node:fs"
import * as path from "node:path"
import { run } from "fascicle"
import { RidgelineConfig } from "../types.js"
import { printInfo, printWarn } from "../ui/output.js"
import { logTrajectory } from "../stores/trajectory.js"
import { recordCost } from "../stores/budget.js"
import { runEnsemblePlanner } from "../engine/ensemble.js"
import { runPlanReviewer, revisePlanWithFeedback, reportPhaseSizeWarnings } from "../engine/plan-reviewer.js"
import { advancePipeline } from "../stores/state.js"
import { scanPhases } from "../stores/phases.js"
import { makeRidgelineEngine } from "../engine/engine.factory.js"
import { planFlow } from "../engine/flows/plan.flow.js"

export const runPlan = async (config: RidgelineConfig): Promise<void> => {
  const specPath = path.join(config.buildDir, "spec.md")
  if (!fs.existsSync(specPath)) {
    throw new Error(`spec.md not found at ${specPath}. Run 'ridgeline init ${config.buildName}' first.`)
  }
  if (!fs.existsSync(config.constraintsPath)) {
    throw new Error(`constraints.md not found at ${config.constraintsPath}`)
  }

  fs.mkdirSync(config.phasesDir, { recursive: true })

  printInfo("Running planner...")
  logTrajectory(config.buildDir, "plan_start", null, "Planning started")

  const engine = makeRidgelineEngine({
    sandboxFlag: config.sandboxMode,
    timeoutMinutes: config.timeoutMinutes,
    pluginDirs: [],
    settingSources: ["user", "project", "local"],
    buildPath: config.buildDir,
  })

  const flow = planFlow({
    runEnsemblePlanner,
    runPlanReviewer,
    revisePlanWithFeedback,
    rescanPhases: scanPhases,
    onReviewerError: (err) => {
      printWarn(`Plan reviewer failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
    },
    onReviewerApproved: (phaseCount) => {
      printInfo(`Plan reviewer: approved (${phaseCount} phases)`)
    },
    onReviewerRejected: (issues) => {
      printWarn(`Plan reviewer rejected the plan with ${issues.length} issue(s):`)
      for (const issue of issues) {
        printWarn(`  - ${issue}`)
      }
    },
    onRevisionComplete: (newCount) => {
      printInfo(`Plan revised: ${newCount} phases (one-shot revision; not re-reviewed).`)
    },
  })

  let outcome
  try {
    outcome = await run(flow, { config }, { install_signal_handlers: false })
  } finally {
    await engine.dispose()
  }

  const { ensemble, review, revisionResult, phasesAfterReview } = outcome

  for (let i = 0; i < ensemble.specialistResults.length; i++) {
    recordCost(config.buildDir, "plan", "specialist", i, ensemble.specialistResults[i])
  }
  recordCost(config.buildDir, "plan", "synthesizer", 0, ensemble.synthesizerResult)

  logTrajectory(config.buildDir, "plan_complete", null, `Generated ${outcome.phases.length} phases`, {
    duration: ensemble.totalDurationMs,
    tokens: {
      input: ensemble.specialistResults.reduce((sum, r) => sum + r.usage.inputTokens, 0) + ensemble.synthesizerResult.usage.inputTokens,
      output: ensemble.specialistResults.reduce((sum, r) => sum + r.usage.outputTokens, 0) + ensemble.synthesizerResult.usage.outputTokens,
    },
    costUsd: ensemble.totalCostUsd,
  })

  if (review) {
    recordCost(config.buildDir, "plan", "synthesizer", 1, review.reviewerResult)
  }
  if (revisionResult) {
    recordCost(config.buildDir, "plan", "synthesizer", 2, revisionResult)
  }

  reportPhaseSizeWarnings(config)

  advancePipeline(config.buildDir, config.buildName, "plan")

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
