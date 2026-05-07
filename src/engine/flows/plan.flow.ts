import { compose, step, type Step } from "fascicle"
import type { ClaudeResult, EnsembleResult, PhaseInfo, PlanVerdict, RidgelineConfig } from "../../types.js"

export type PlanFlowInput = {
  readonly config: RidgelineConfig
}

export type PlanFlowOutput = {
  readonly phases: PhaseInfo[]
  readonly ensemble: EnsembleResult
  readonly review: { verdict: PlanVerdict; reviewerResult: ClaudeResult } | null
  readonly revisionResult: ClaudeResult | null
  readonly phasesAfterReview: PhaseInfo[]
}

export type PlanFlowExecutors = {
  readonly invokePlanner: (config: RidgelineConfig) => Promise<{ phases: PhaseInfo[]; ensemble: EnsembleResult }>
  readonly runPlanReviewer: (config: RidgelineConfig) => Promise<{ verdict: PlanVerdict; result: ClaudeResult }>
  readonly revisePlanWithFeedback: (config: RidgelineConfig, issues: string[]) => Promise<ClaudeResult>
  readonly rescanPhases: (phasesDir: string) => PhaseInfo[]
  readonly onReviewerError: (err: unknown) => void
  readonly onReviewerApproved: (phaseCount: number) => void
  readonly onReviewerRejected: (issues: string[]) => void
  readonly onRevisionComplete: (newCount: number) => void
}

export type PlanFlowDeps = PlanFlowExecutors

export const planFlow = (deps: PlanFlowDeps): Step<PlanFlowInput, PlanFlowOutput> => {
  const inner = step("plan.inner", async (input: PlanFlowInput): Promise<PlanFlowOutput> => {
    const { config } = input
    const { phases, ensemble } = await deps.invokePlanner(config)

    let review: { verdict: PlanVerdict; reviewerResult: ClaudeResult } | null = null
    let revisionResult: ClaudeResult | null = null
    let phasesAfterReview = phases

    try {
      const { verdict, result: reviewerResult } = await deps.runPlanReviewer(config)
      review = { verdict, reviewerResult }
      if (verdict.approved) {
        deps.onReviewerApproved(phases.length)
      } else {
        deps.onReviewerRejected(verdict.issues)
        revisionResult = await deps.revisePlanWithFeedback(config, verdict.issues)
        phasesAfterReview = deps.rescanPhases(config.phasesDir)
        deps.onRevisionComplete(phasesAfterReview.length)
      }
    } catch (err) {
      deps.onReviewerError(err)
    }

    return { phases, ensemble, review, revisionResult, phasesAfterReview }
  })
  return compose("plan", inner)
}
