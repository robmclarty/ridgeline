import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { RidgelineConfig, PhaseInfo, BuildState, ClaudeResult, ReviewVerdict } from "../../../types"

// Mock all external dependencies
vi.mock("../../../stores/tags", () => ({
  createCheckpoint: vi.fn(),
  createCompletionTag: vi.fn((buildName: string, phaseId: string) => `ridgeline/phase/${buildName}/${phaseId}`),
}))

vi.mock("../../../stores/budget", () => ({
  recordCost: vi.fn(() => ({ entries: [], totalCostUsd: 0.10 })),
  getTotalCost: vi.fn(() => 0.10),
  getPhaseCostUsd: vi.fn(() => 0),
}))

vi.mock("../../../stores/handoff", () => ({
  ensureHandoffExists: vi.fn(),
}))

vi.mock("../../../stores/state", () => ({
  updatePhaseStatus: vi.fn(),
}))

vi.mock("../../../ui/output", () => ({
  printPhase: vi.fn(),
}))

vi.mock("../../../stores/trajectory", () => ({
  logTrajectory: vi.fn(),
  makeTrajectoryEntry: vi.fn(() => ({
    timestamp: "2024-01-01T00:00:00.000Z",
    type: "build_start",
    phaseId: null,
    duration: null,
    tokens: null,
    costUsd: null,
    summary: "",
  })),
}))

vi.mock("../build.loop", () => ({
  runBuilderLoop: vi.fn(),
}))

vi.mock("../review.exec", () => ({
  invokeReviewer: vi.fn(),
}))

vi.mock("../../../stores/feedback.verdict", () => ({
  formatIssue: vi.fn((issue: { description: string; file?: string }) =>
    issue.file ? `${issue.file}: ${issue.description}` : issue.description
  ),
}))

vi.mock("../../../stores/feedback.io", () => ({
  writeFeedback: vi.fn(),
  archiveFeedback: vi.fn(),
}))

vi.mock("../../../git", () => ({
  isWorkingTreeDirty: vi.fn(() => false),
  commitAll: vi.fn(),
}))

import { runPhase, backoffMs } from "../phase.sequence"
import { runBuilderLoop } from "../build.loop"
import type { BuilderLoopOutcome } from "../build.loop"
import type { BuilderInvocation } from "../../../types"
import { invokeReviewer } from "../review.exec"
import { createCheckpoint, createCompletionTag } from "../../../stores/tags"
import { recordCost } from "../../../stores/budget"
import { updatePhaseStatus } from "../../../stores/state"

const makeResult = (cost = 0.05): ClaudeResult => ({
  success: true,
  result: "done\nREADY_FOR_REVIEW",
  durationMs: 5000,
  costUsd: cost,
  usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  sessionId: "sess",
})

const makeReadyOutcome = (cost = 0.05): BuilderLoopOutcome => {
  const result = makeResult(cost)
  const invocation: BuilderInvocation = {
    attempt: 1,
    endReason: "ready_for_review",
    outputTokens: result.usage.outputTokens,
    inputTokens: result.usage.inputTokens,
    costUsd: result.costUsd,
    durationMs: result.durationMs,
    windDownReason: null,
    diffHash: null,
    timestamp: new Date().toISOString(),
  }
  return {
    invocations: [invocation],
    finalResult: result,
    cumulativeOutputTokens: result.usage.outputTokens,
    cumulativeCostUsd: result.costUsd,
    endReason: "ready_for_review",
  }
}

const passVerdict: ReviewVerdict = {
  passed: true,
  summary: "All good",
  criteriaResults: [{ criterion: 1, passed: true, notes: "ok" }],
  issues: [],
  suggestions: [],
  sensorFindings: [],
}

const failVerdict: ReviewVerdict = {
  passed: false,
  summary: "Issues found",
  criteriaResults: [{ criterion: 1, passed: false, notes: "bad" }],
  issues: [{ description: "thing is broken", severity: "blocking" as const }],
  suggestions: [{ description: "fix it", severity: "suggestion" as const }],
  sensorFindings: [],
}

const config: RidgelineConfig = {
  buildName: "test-build",
  ridgelineDir: "/tmp/ridgeline",
  buildDir: "/tmp/build",
  constraintsPath: "/tmp/constraints.md",
  tastePath: null,
  handoffPath: "/tmp/build/handoff.md",
  phasesDir: "/tmp/build/phases",
  model: "opus",
  maxRetries: 2,
  timeoutMinutes: 120,
  checkTimeoutSeconds: 1200,
  checkCommand: "npm test",
  maxBudgetUsd: null,
  unsafe: false,
  sandboxMode: "semi-locked",
  sandboxExtras: { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
  networkAllowlist: [],
  extraContext: null,
  specialistCount: 2,
  specialistTimeoutSeconds: 180,
  phaseBudgetLimit: 15,
  phaseTokenLimit: 80000,
}

const phase: PhaseInfo = {
  id: "01-scaffold",
  index: 1,
  slug: "scaffold",
  filename: "01-scaffold.md",
  filepath: "/tmp/build/phases/01-scaffold.md",
  dependsOn: [],
}

const makeState = (): BuildState => ({
  buildName: "test-build",
  startedAt: "2024-01-01T00:00:00.000Z",
  pipeline: { shape: "complete", design: "skipped", spec: "complete", research: "skipped", refine: "skipped", plan: "complete", build: "running" },
  phases: [
    {
      id: "01-scaffold",
      status: "pending",
      checkpointTag: "ridgeline/checkpoint/test-build/01-scaffold",
      completionTag: null,
      retries: 0,
      duration: null,
      completedAt: null,
      failedAt: null,
    },
  ],
})

describe("phaseRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("runPhase", () => {
    it("returns 'passed' when builder and reviewer succeed", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(invokeReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      const result = await runPhase(phase, config, makeState())
      expect(result).toBe("passed")
    })

    it("creates checkpoint tag before building", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(invokeReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      await runPhase(phase, config, makeState())
      expect(createCheckpoint).toHaveBeenCalledWith("ridgeline/checkpoint/test-build/01-scaffold", "01-scaffold", undefined)
    })

    it("retries on reviewer failure up to maxRetries", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(invokeReviewer)
        .mockResolvedValueOnce({ result: makeResult(), verdict: failVerdict })
        .mockResolvedValueOnce({ result: makeResult(), verdict: failVerdict })
        .mockResolvedValueOnce({ result: makeResult(), verdict: passVerdict })

      const result = await runPhase(phase, config, makeState())
      expect(result).toBe("passed")
      expect(runBuilderLoop).toHaveBeenCalledTimes(3)
    })

    it("returns 'failed' when retries exhausted", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(invokeReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: failVerdict,
      })

      const result = await runPhase(phase, config, makeState())
      expect(result).toBe("failed")
      // 1 initial + 2 retries = 3 attempts
      expect(runBuilderLoop).toHaveBeenCalledTimes(3)
    })

    it("records reviewer cost (builder costs are recorded inside the loop hook, mocked here)", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(invokeReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      await runPhase(phase, config, makeState())
      // reviewer only — the builder loop's onInvocationComplete hook records
      // builder costs internally; with the loop mocked, only the reviewer
      // recordCost call is observable here.
      expect(recordCost).toHaveBeenCalledTimes(1)
      expect(recordCost).toHaveBeenCalledWith(expect.any(String), "01-scaffold", "reviewer", 0, expect.any(Object))
    })

    it("returns 'failed' when builder loop reports halt_global_budget", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue({
        ...makeReadyOutcome(),
        endReason: "halt_global_budget",
      })

      const result = await runPhase(phase, { ...config, maxBudgetUsd: 50 }, makeState())
      expect(result).toBe("failed")
    })

    it("returns 'failed' immediately on authentication error without retrying", async () => {
      vi.mocked(runBuilderLoop).mockRejectedValue(new Error("Authentication failed. Refresh your OAuth token."))

      const result = await runPhase(phase, config, makeState())
      expect(result).toBe("failed")
      expect(runBuilderLoop).toHaveBeenCalledTimes(1)
    })

    it("throws when phase not found in state", async () => {
      const state = makeState()
      state.phases = []

      await expect(runPhase(phase, config, state)).rejects.toThrow("Phase 01-scaffold not found in state")
    })

    it("continues to next attempt when builder loop throws", async () => {
      vi.mocked(runBuilderLoop)
        .mockRejectedValueOnce(new Error("builder crashed"))
        .mockResolvedValue(makeReadyOutcome())
      vi.mocked(invokeReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      const result = await runPhase(phase, config, makeState())
      // First attempt fails (builder loop error), second succeeds
      expect(result).toBe("passed")
    })

    it("continues to next attempt when reviewer throws", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(invokeReviewer)
        .mockRejectedValueOnce(new Error("eval crashed"))
        .mockResolvedValueOnce({ result: makeResult(), verdict: passVerdict })

      const result = await runPhase(phase, config, makeState())
      expect(result).toBe("passed")
    })

    it("creates completion tag on success", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(invokeReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      await runPhase(phase, config, makeState())
      expect(createCompletionTag).toHaveBeenCalledWith("test-build", "01-scaffold", undefined)
    })

    it("updates phase status to complete on success", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(invokeReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      await runPhase(phase, config, makeState())
      expect(updatePhaseStatus).toHaveBeenCalledWith(
        "/tmp/build",
        expect.any(Object),
        "01-scaffold",
        expect.objectContaining({ status: "complete" })
      )
    })
  })
})

describe("backoffMs", () => {
  it("returns a value in the expected range for attempt 0", () => {
    const delay = backoffMs(0)
    // base = 1000, jitter = 0..500, so range [1000, 1500]
    expect(delay).toBeGreaterThanOrEqual(1000)
    expect(delay).toBeLessThanOrEqual(1500)
  })

  it("doubles the base per attempt", () => {
    // Run many samples to check the range
    for (let i = 0; i < 20; i++) {
      const d1 = backoffMs(1) // base 2000
      expect(d1).toBeGreaterThanOrEqual(2000)
      expect(d1).toBeLessThanOrEqual(3000)

      const d2 = backoffMs(2) // base 4000
      expect(d2).toBeGreaterThanOrEqual(4000)
      expect(d2).toBeLessThanOrEqual(6000)
    }
  })

  it("caps at 60 seconds regardless of attempt number", () => {
    for (let i = 0; i < 20; i++) {
      const delay = backoffMs(10) // base = min(1024000, 60000) = 60000
      expect(delay).toBeGreaterThanOrEqual(60_000)
      expect(delay).toBeLessThanOrEqual(90_000)
    }
  })
})
