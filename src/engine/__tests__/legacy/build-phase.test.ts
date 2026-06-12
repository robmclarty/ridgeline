import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { uniformStageModels } from "../../../../test/factories.js"
import type { RidgelineConfig, PhaseInfo, BuildState, ClaudeResult, ReviewVerdict } from "../../../types.js"

// Mock all external dependencies
vi.mock("../../../stores/tags.js", () => ({
  createCheckpoint: vi.fn(),
  createCompletionTag: vi.fn((buildName: string, phaseId: string) => `ridgeline/phase/${buildName}/${phaseId}`),
}))

vi.mock("../../../stores/budget.js", () => ({
  recordCost: vi.fn(() => ({ entries: [], totalCostUsd: 0.10 })),
  getTotalCost: vi.fn(() => 0.10),
  getPhaseCostUsd: vi.fn(() => 0),
}))

vi.mock("../../../stores/handoff.js", () => ({
  ensureHandoffExists: vi.fn(),
}))

vi.mock("../../../stores/state.js", () => ({
  updatePhaseStatus: vi.fn(),
}))

vi.mock("../../../ui/output.js", () => ({
  printPhase: vi.fn(),
}))

vi.mock("../../../stores/trajectory.js", () => ({
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

// Sentinel returned by the (mocked) engine-invoker factory so tests can assert
// which role models route to the engine vs the spawn path. Hoisted because
// vi.mock factories run before module-level const initializers.
const { engineInvokerSentinel } = vi.hoisted(() => ({ engineInvokerSentinel: vi.fn() }))
vi.mock("../../builder-loop.js", () => ({
  runBuilderLoop: vi.fn(),
  makeEngineBuilderInvoker: vi.fn(() => engineInvokerSentinel),
}))

vi.mock("../../reviewer.js", () => ({
  runReviewer: vi.fn(),
}))

vi.mock("../../../stores/feedback.verdict.js", () => ({
  formatIssue: vi.fn((issue: { description: string; file?: string }) =>
    issue.file ? `${issue.file}: ${issue.description}` : issue.description
  ),
}))

vi.mock("../../../stores/feedback.io.js", () => ({
  writeFeedback: vi.fn(),
  archiveFeedback: vi.fn(),
}))

vi.mock("../../../git.js", () => ({
  isWorkingTreeDirty: vi.fn(() => false),
  commitAll: vi.fn(),
}))

import { executeBuildPhase, backoffMs } from "../../build-phase.js"
import { runBuilderLoop } from "../../builder-loop.js"
import type { BuilderLoopOutcome } from "../../builder-loop.js"
import type { BuilderInvocation } from "../../../types.js"
import { runReviewer } from "../../reviewer.js"
import { createCheckpoint, createCompletionTag } from "../../../stores/tags.js"
import { recordCost } from "../../../stores/budget.js"
import { updatePhaseStatus } from "../../../stores/state.js"
import { logTrajectory } from "../../../stores/trajectory.js"

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
  models: uniformStageModels("opus"),
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
  sequencing: { kind: "sequential" },
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

  describe("executeBuildPhase", () => {
    it("returns 'passed' when builder and reviewer succeed", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(runReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      const result = await executeBuildPhase(phase, config, makeState())
      expect(result).toBe("passed")
    })

    it("creates checkpoint tag before building", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(runReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      await executeBuildPhase(phase, config, makeState())
      expect(createCheckpoint).toHaveBeenCalledWith("ridgeline/checkpoint/test-build/01-scaffold", "01-scaffold", undefined)
    })

    it("retries on reviewer failure up to maxRetries", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(runReviewer)
        .mockResolvedValueOnce({ result: makeResult(), verdict: failVerdict })
        .mockResolvedValueOnce({ result: makeResult(), verdict: failVerdict })
        .mockResolvedValueOnce({ result: makeResult(), verdict: passVerdict })

      const result = await executeBuildPhase(phase, config, makeState())
      expect(result).toBe("passed")
      expect(runBuilderLoop).toHaveBeenCalledTimes(3)
    })

    it("returns 'failed' when retries exhausted", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(runReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: failVerdict,
      })

      const result = await executeBuildPhase(phase, config, makeState())
      expect(result).toBe("failed")
      // 1 initial + 2 retries = 3 attempts
      expect(runBuilderLoop).toHaveBeenCalledTimes(3)
    })

    it("records reviewer cost (builder costs are recorded inside the loop hook, mocked here)", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(runReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      await executeBuildPhase(phase, config, makeState())
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

      const result = await executeBuildPhase(phase, { ...config, maxBudgetUsd: 50 }, makeState())
      expect(result).toBe("failed")
    })

    it("returns 'failed' immediately on authentication error without retrying", async () => {
      vi.mocked(runBuilderLoop).mockRejectedValue(new Error("Authentication failed. Refresh your OAuth token."))

      const result = await executeBuildPhase(phase, config, makeState())
      expect(result).toBe("failed")
      expect(runBuilderLoop).toHaveBeenCalledTimes(1)
    })

    it("throws when phase not found in state", async () => {
      const state = makeState()
      state.phases = []

      await expect(executeBuildPhase(phase, config, state)).rejects.toThrow("Phase 01-scaffold not found in state")
    })

    it("continues to next attempt when builder loop throws", async () => {
      vi.mocked(runBuilderLoop)
        .mockRejectedValueOnce(new Error("builder crashed"))
        .mockResolvedValue(makeReadyOutcome())
      vi.mocked(runReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      const result = await executeBuildPhase(phase, config, makeState())
      // First attempt fails (builder loop error), second succeeds
      expect(result).toBe("passed")
    })

    it("continues to next attempt when reviewer throws", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(runReviewer)
        .mockRejectedValueOnce(new Error("eval crashed"))
        .mockResolvedValueOnce({ result: makeResult(), verdict: passVerdict })

      const result = await executeBuildPhase(phase, config, makeState())
      expect(result).toBe("passed")
    })

    it("creates completion tag on success", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(runReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      await executeBuildPhase(phase, config, makeState())
      expect(createCompletionTag).toHaveBeenCalledWith("test-build", "01-scaffold", undefined)
    })

    it("updates phase status to complete on success", async () => {
      vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
      vi.mocked(runReviewer).mockResolvedValue({
        result: makeResult(),
        verdict: passVerdict,
      })

      await executeBuildPhase(phase, config, makeState())
      expect(updatePhaseStatus).toHaveBeenCalledWith(
        "/tmp/build",
        expect.any(Object),
        "01-scaffold",
        expect.objectContaining({ status: "complete" })
      )
    })

    describe("hybrid role routing", () => {
      const qwen = "openrouter:qwen/qwen3-coder-30b-a3b-instruct"
      const fakeEngine = {} as import("fascicle").Engine

      beforeEach(() => {
        // Pin bare-family routing to claude_cli regardless of the host env.
        vi.stubEnv("ANTHROPIC_API_KEY", "")
        vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
        vi.mocked(runReviewer).mockResolvedValue({
          result: makeResult(),
          verdict: passVerdict,
        })
      })

      afterEach(() => {
        vi.unstubAllEnvs()
      })

      const phaseProviderEvents = () =>
        vi.mocked(logTrajectory).mock.calls.filter((c) => c[1] === "phase_provider")

      it("logs builder and reviewer phase_provider events from their role models", async () => {
        const hybrid = { ...config, models: { ...config.models, builder: qwen } }
        await executeBuildPhase(phase, hybrid, makeState(), undefined, fakeEngine)

        const events = phaseProviderEvents()
        expect(events).toHaveLength(2)
        expect(events[0][3]).toBe("Routing 01-scaffold builder to openrouter (qwen/qwen3-coder-30b-a3b-instruct)")
        expect(events[0][4]).toEqual({ provider: "openrouter", model: "qwen/qwen3-coder-30b-a3b-instruct" })
        expect(events[1][3]).toBe("Routing 01-scaffold reviewer to claude_cli (opus)")
        expect(events[1][4]).toEqual({ provider: "claude_cli", model: "opus" })
      })

      it("routes only the non-Claude builder to the engine; the Claude reviewer stays on spawn", async () => {
        const hybrid = { ...config, models: { ...config.models, builder: qwen } }
        await executeBuildPhase(phase, hybrid, makeState(), undefined, fakeEngine)

        expect(vi.mocked(runBuilderLoop).mock.calls[0][0].invoker).toBe(engineInvokerSentinel)
        // 6th runReviewer arg is the reviewer engine: undefined keeps spawn.
        expect(vi.mocked(runReviewer).mock.calls[0][5]).toBeUndefined()
      })

      it("routes only the non-Claude reviewer to the engine; the Claude builder keeps spawn", async () => {
        const hybrid = { ...config, models: { ...config.models, reviewer: qwen } }
        await executeBuildPhase(phase, hybrid, makeState(), undefined, fakeEngine)

        expect(vi.mocked(runBuilderLoop).mock.calls[0][0].invoker).toBeUndefined()
        expect(vi.mocked(runReviewer).mock.calls[0][5]).toBe(fakeEngine)
      })
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
