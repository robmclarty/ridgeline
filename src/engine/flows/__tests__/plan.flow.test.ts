import { describe, it, expect, vi } from "vitest"
import { run } from "fascicle"
import { planFlow } from "../plan.flow.js"
import type {
  ClaudeResult,
  EnsembleResult,
  PhaseInfo,
  PlanVerdict,
  RidgelineConfig,
} from "../../../types.js"

const cannedClaudeResult = (): ClaudeResult => ({
  success: true,
  result: "ok",
  durationMs: 1,
  costUsd: 0,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  sessionId: "s",
})

const cannedEnsemble = (): EnsembleResult => ({
  specialistNames: [],
  specialistResults: [],
  synthesizerResult: cannedClaudeResult(),
  totalCostUsd: 0,
  totalDurationMs: 0,
})

const phase: PhaseInfo = {
  id: "01-x",
  index: 1,
  slug: "x",
  filename: "01-x.md",
  filepath: "/tmp/01-x.md",
  dependsOn: [],
}

const stubConfig = (): RidgelineConfig => ({} as never)

describe("planFlow", () => {
  it("dispatches planner then reviewer when reviewer approves", async () => {
    const onApproved = vi.fn()
    const flow = planFlow({
      invokePlanner: async () => ({ phases: [phase], ensemble: cannedEnsemble() }),
      runPlanReviewer: async () => ({
        verdict: { approved: true, issues: [] },
        result: cannedClaudeResult(),
      }),
      revisePlanWithFeedback: async () => cannedClaudeResult(),
      rescanPhases: () => [phase],
      onReviewerError: vi.fn(),
      onReviewerApproved: onApproved,
      onReviewerRejected: vi.fn(),
      onRevisionComplete: vi.fn(),
    })

    const out = await run(flow, { config: stubConfig() }, { install_signal_handlers: false })
    expect(onApproved).toHaveBeenCalledWith(1)
    expect(out.review).not.toBeNull()
    expect(out.revisionResult).toBeNull()
    expect(out.phasesAfterReview).toHaveLength(1)
  })

  it("revises plan when reviewer rejects", async () => {
    const onRejected = vi.fn()
    const onRevisionComplete = vi.fn()
    const verdict: PlanVerdict = { approved: false, issues: ["issue-a"] }
    const revisedPhases = [phase, { ...phase, id: "02-y" }]

    const flow = planFlow({
      invokePlanner: async () => ({ phases: [phase], ensemble: cannedEnsemble() }),
      runPlanReviewer: async () => ({ verdict, result: cannedClaudeResult() }),
      revisePlanWithFeedback: async () => cannedClaudeResult(),
      rescanPhases: () => revisedPhases,
      onReviewerError: vi.fn(),
      onReviewerApproved: vi.fn(),
      onReviewerRejected: onRejected,
      onRevisionComplete,
    })

    const out = await run(flow, { config: stubConfig() }, { install_signal_handlers: false })
    expect(onRejected).toHaveBeenCalledWith(["issue-a"])
    expect(onRevisionComplete).toHaveBeenCalledWith(2)
    expect(out.revisionResult).not.toBeNull()
    expect(out.phasesAfterReview).toHaveLength(2)
  })

  it("calls onReviewerError when reviewer throws and continues with original phases", async () => {
    const onError = vi.fn()
    const flow = planFlow({
      invokePlanner: async () => ({ phases: [phase], ensemble: cannedEnsemble() }),
      runPlanReviewer: async () => {
        throw new Error("review-failed")
      },
      revisePlanWithFeedback: async () => cannedClaudeResult(),
      rescanPhases: () => [phase],
      onReviewerError: onError,
      onReviewerApproved: vi.fn(),
      onReviewerRejected: vi.fn(),
      onRevisionComplete: vi.fn(),
    })

    const out = await run(flow, { config: stubConfig() }, { install_signal_handlers: false })
    expect(onError).toHaveBeenCalled()
    expect(out.review).toBeNull()
    expect(out.revisionResult).toBeNull()
    expect(out.phasesAfterReview).toHaveLength(1)
  })
})
