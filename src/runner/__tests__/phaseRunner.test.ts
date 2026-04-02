import { describe, it, expect, vi, beforeEach } from "vitest"
import type { RidgelineConfig, PhaseInfo, BuildState, ClaudeResult, ReviewVerdict } from "../../types"

// Mock all external dependencies
vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => "check output"),
}))

vi.mock("../../git", () => ({
  isWorkingTreeDirty: vi.fn(() => false),
  commitAll: vi.fn(),
  createTag: vi.fn(),
}))

vi.mock("../../state/budget", () => ({
  recordCost: vi.fn(() => ({ entries: [], totalCostUsd: 0.10 })),
  getTotalCost: vi.fn(() => 0.10),
}))

vi.mock("../../state/handoff", () => ({
  ensureHandoffExists: vi.fn(),
}))

vi.mock("../../state/stateManager", () => ({
  updatePhaseStatus: vi.fn(),
}))

vi.mock("../../logging", () => ({
  logPhase: vi.fn(),
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

vi.mock("../buildInvoker", () => ({
  invokeBuilder: vi.fn(),
}))

vi.mock("../reviewerInvoker", () => ({
  invokeReviewer: vi.fn(),
}))

import { runPhase } from "../phaseRunner"
import { invokeBuilder } from "../buildInvoker"
import { invokeReviewer } from "../reviewerInvoker"
import { isWorkingTreeDirty, commitAll, createTag } from "../../git"
import { recordCost } from "../../state/budget"
import { updatePhaseStatus } from "../../state/stateManager"

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
  issues: ["thing is broken"],
  suggestions: ["fix it"],
}

const config: RidgelineConfig = {
  buildName: "test-build",
  buildDir: "/tmp/build",
  constraintsPath: "/tmp/constraints.md",
  tastePath: null,
  snapshotPath: "/tmp/build/snapshot.md",
  handoffPath: "/tmp/build/handoff.md",
  phasesDir: "/tmp/build/phases",
  model: "opus",
  maxRetries: 2,
  timeoutMinutes: 30,
  verbose: false,
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
      expect(createTag).toHaveBeenCalledWith("ridgeline/checkpoint/test-build/01-scaffold")
    })

    it("commits dirty tree before checkpointing", async () => {
      vi.mocked(isWorkingTreeDirty).mockReturnValue(true)
      vi.mocked(invokeBuilder).mockResolvedValue(makeResult())
      vi.mocked(invokeReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      await runPhase(phase, config, makeState())
      expect(commitAll).toHaveBeenCalledWith("chore: pre-phase checkpoint for 01-scaffold")
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
      expect(createTag).toHaveBeenCalledWith("ridgeline/phase/test-build/01-scaffold")
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
