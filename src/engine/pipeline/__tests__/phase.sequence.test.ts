import { describe, it, expect, vi, beforeEach } from "vitest"
import type { RidgelineConfig, PhaseInfo, BuildState, ClaudeResult, ReviewVerdict } from "../../../types"

// Mock all external dependencies
vi.mock("../../../store/tags", () => ({
  createCheckpoint: vi.fn(),
  createCompletionTag: vi.fn((buildName: string, phaseId: string) => `ridgeline/phase/${buildName}/${phaseId}`),
}))

vi.mock("../../../store/budget", () => ({
  recordCost: vi.fn(() => ({ entries: [], totalCostUsd: 0.10 })),
  getTotalCost: vi.fn(() => 0.10),
}))

vi.mock("../../../store/handoff", () => ({
  ensureHandoffExists: vi.fn(),
}))

vi.mock("../../../store/state", () => ({
  updatePhaseStatus: vi.fn(),
}))

vi.mock("../../../ui/output", () => ({
  printPhase: vi.fn(),
}))

vi.mock("../../../store/trajectory", () => ({
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

vi.mock("../build.exec", () => ({
  invokeBuilder: vi.fn(),
}))

vi.mock("../review.exec", () => ({
  invokeReviewer: vi.fn(),
}))

vi.mock("../../../store/feedback", () => ({
  formatIssue: vi.fn((issue: { description: string; file?: string }) =>
    issue.file ? `${issue.file}: ${issue.description}` : issue.description
  ),
  writeFeedback: vi.fn(),
  archiveFeedback: vi.fn(),
}))

import { runPhase } from "../phase.sequence"
import { invokeBuilder } from "../build.exec"
import { invokeReviewer } from "../review.exec"
import { createCheckpoint, createCompletionTag } from "../../../store/tags"
import { recordCost } from "../../../store/budget"
import { updatePhaseStatus } from "../../../store/state"

const makeResult = (cost = 0.05): ClaudeResult => ({
  success: true,
  result: "done",
  durationMs: 5000,
  costUsd: cost,
  usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  sessionId: "sess",
})

const passVerdict: ReviewVerdict = {
  passed: true,
  summary: "All good",
  criteriaResults: [{ criterion: 1, passed: true, notes: "ok" }],
  issues: [],
  suggestions: [],
}

const failVerdict: ReviewVerdict = {
  passed: false,
  summary: "Issues found",
  criteriaResults: [{ criterion: 1, passed: false, notes: "bad" }],
  issues: [{ description: "thing is broken", severity: "blocking" as const }],
  suggestions: [{ description: "fix it", severity: "suggestion" as const }],
}

const config: RidgelineConfig = {
  buildName: "test-build",
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
}

const phase: PhaseInfo = {
  id: "01-scaffold",
  index: 1,
  slug: "scaffold",
  filename: "01-scaffold.md",
  filepath: "/tmp/build/phases/01-scaffold.md",
}

const makeState = (): BuildState => ({
  buildName: "test-build",
  startedAt: "2024-01-01T00:00:00.000Z",
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
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  describe("runPhase", () => {
    it("returns 'passed' when builder and reviewer succeed", async () => {
      vi.mocked(invokeBuilder).mockResolvedValue(makeResult())
      vi.mocked(invokeReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      const result = await runPhase(phase, config, makeState())
      expect(result).toBe("passed")
    })

    it("creates checkpoint tag before building", async () => {
      vi.mocked(invokeBuilder).mockResolvedValue(makeResult())
      vi.mocked(invokeReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      await runPhase(phase, config, makeState())
      expect(createCheckpoint).toHaveBeenCalledWith("ridgeline/checkpoint/test-build/01-scaffold", "01-scaffold", undefined)
    })

    it("retries on reviewer failure up to maxRetries", async () => {
      vi.mocked(invokeBuilder).mockResolvedValue(makeResult())
      vi.mocked(invokeReviewer)
        .mockResolvedValueOnce({ result: makeResult(), verdict: failVerdict })
        .mockResolvedValueOnce({ result: makeResult(), verdict: failVerdict })
        .mockResolvedValueOnce({ result: makeResult(), verdict: passVerdict })

      const result = await runPhase(phase, config, makeState())
      expect(result).toBe("passed")
      expect(invokeBuilder).toHaveBeenCalledTimes(3)
    })

    it("returns 'failed' when retries exhausted", async () => {
      vi.mocked(invokeBuilder).mockResolvedValue(makeResult())
      vi.mocked(invokeReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: failVerdict,
      })

      const result = await runPhase(phase, config, makeState())
      expect(result).toBe("failed")
      // 1 initial + 2 retries = 3 attempts
      expect(invokeBuilder).toHaveBeenCalledTimes(3)
    })

    it("records costs for each attempt", async () => {
      vi.mocked(invokeBuilder).mockResolvedValue(makeResult())
      vi.mocked(invokeReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      await runPhase(phase, config, makeState())
      // builder + reviewer
      expect(recordCost).toHaveBeenCalledTimes(2)
    })

    it("returns 'failed' when budget is exceeded", async () => {
      vi.mocked(invokeBuilder).mockResolvedValue(makeResult())
      vi.mocked(recordCost).mockReturnValue({ entries: [], totalCostUsd: 100 })

      const result = await runPhase(phase, { ...config, maxBudgetUsd: 50 }, makeState())
      expect(result).toBe("failed")
    })

    it("throws when phase not found in state", async () => {
      const state = makeState()
      state.phases = []

      await expect(runPhase(phase, config, state)).rejects.toThrow("Phase 01-scaffold not found in state")
    })

    it("continues to next attempt when builder throws", async () => {
      vi.mocked(invokeBuilder)
        .mockRejectedValueOnce(new Error("builder crashed"))
        .mockResolvedValueOnce(makeResult())
        .mockResolvedValueOnce(makeResult())
      vi.mocked(invokeReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      const result = await runPhase(phase, config, makeState())
      // First attempt fails (builder error), second succeeds
      expect(result).toBe("passed")
    })

    it("continues to next attempt when reviewer throws", async () => {
      vi.mocked(invokeBuilder).mockResolvedValue(makeResult())
      vi.mocked(invokeReviewer)
        .mockRejectedValueOnce(new Error("eval crashed"))
        .mockResolvedValueOnce({ result: makeResult(), verdict: passVerdict })

      const result = await runPhase(phase, config, makeState())
      expect(result).toBe("passed")
    })

    it("creates completion tag on success", async () => {
      vi.mocked(invokeBuilder).mockResolvedValue(makeResult())
      vi.mocked(invokeReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      await runPhase(phase, config, makeState())
      expect(createCompletionTag).toHaveBeenCalledWith("test-build", "01-scaffold", undefined)
    })

    it("updates phase status to complete on success", async () => {
      vi.mocked(invokeBuilder).mockResolvedValue(makeResult())
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
