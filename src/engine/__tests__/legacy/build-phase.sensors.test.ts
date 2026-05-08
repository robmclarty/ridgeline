import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { RidgelineConfig, PhaseInfo, BuildState, ClaudeResult, ReviewVerdict } from "../../../types.js"

vi.mock("../../../stores/tags.js", () => ({
  createCheckpoint: vi.fn(),
  createCompletionTag: vi.fn(() => "completion-tag"),
}))

vi.mock("../../../stores/budget.js", () => ({
  recordCost: vi.fn(() => ({ entries: [], totalCostUsd: 0.05 })),
  getTotalCost: vi.fn(() => 0.05),
  getPhaseCostUsd: vi.fn(() => 0),
}))

vi.mock("../../../stores/handoff.js", () => ({ ensureHandoffExists: vi.fn() }))
vi.mock("../../../stores/state.js", () => ({ updatePhaseStatus: vi.fn() }))
vi.mock("../../../ui/output.js", () => ({
  printPhase: vi.fn(),
  printWarn: vi.fn(),
}))
vi.mock("../../../stores/trajectory.js", () => ({ logTrajectory: vi.fn() }))
vi.mock("../../builder-loop.js", () => ({
  runBuilderLoop: vi.fn(),
}))
vi.mock("../../reviewer.js", () => ({ runReviewer: vi.fn() }))
vi.mock("../../../stores/feedback.verdict.js", () => ({
  formatIssue: vi.fn((i: { description: string }) => i.description),
}))
vi.mock("../../../stores/feedback.io.js", () => ({
  writeFeedback: vi.fn(),
  archiveFeedback: vi.fn(),
}))
vi.mock("../../../git.js", () => ({
  isWorkingTreeDirty: vi.fn(() => false),
  commitAll: vi.fn(),
}))

vi.mock("../../project-type.js", () => ({
  detect: vi.fn(),
}))

vi.mock("../../sensors-collect.js", () => ({
  collectSensorFindings: vi.fn(),
}))

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  }
})

import { executeBuildPhase } from "../../build-phase.js"
import { runBuilderLoop } from "../../builder-loop.js"
import type { BuilderLoopOutcome } from "../../builder-loop.js"
import type { BuilderInvocation } from "../../../types.js"
import { runReviewer } from "../../reviewer.js"
import { detect } from "../../project-type.js"
import { collectSensorFindings } from "../../sensors-collect.js"
import { printWarn } from "../../../ui/output.js"

const makeResult = (): ClaudeResult => ({
  success: true,
  result: "done\nREADY_FOR_REVIEW",
  durationMs: 1000,
  costUsd: 0.01,
  usage: { inputTokens: 10, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  sessionId: "sess",
})

const makeReadyOutcome = (): BuilderLoopOutcome => {
  const result = makeResult()
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
  summary: "ok",
  criteriaResults: [],
  issues: [],
  suggestions: [],
  sensorFindings: [],
}

const config: RidgelineConfig = {
  buildName: "test",
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
  checkCommand: null,
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
  requirePhaseApproval: false,
}

const phase: PhaseInfo = {
  id: "07-sensors",
  index: 7,
  slug: "sensors",
  filename: "07-sensors.md",
  filepath: "/tmp/build/phases/07-sensors.md",
  dependsOn: [],
}

const makeState = (): BuildState => ({
  buildName: "test",
  startedAt: "2024-01-01T00:00:00.000Z",
  pipeline: {
    shape: "complete",
    design: "skipped",
    spec: "complete",
    research: "skipped",
    refine: "skipped",
    plan: "complete",
    build: "running",
  },
  phases: [
    {
      id: "07-sensors",
      status: "pending",
      checkpointTag: "ridgeline/checkpoint/test/07-sensors",
      completionTag: null,
      retries: 0,
      duration: null,
      completedAt: null,
      failedAt: null,
    },
  ],
})

describe("build-phase — sensor integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("phase still passes when a sensor rejects (non-fatal warning)", async () => {
    vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
    vi.mocked(runReviewer).mockResolvedValue({ result: makeResult(), verdict: passVerdict })
    vi.mocked(detect).mockResolvedValue({
      projectType: "web",
      isVisualSurface: true,
      detectedDeps: ["react"],
      visualFileExts: [],
      hasDesignMd: false,
      hasAssetDir: false,
      suggestedSensors: ["playwright"],
      suggestedEnsembleSize: 2,
    })
    vi.mocked(collectSensorFindings).mockImplementation(async (_names, _input, options) => {
      options?.onWarn?.("[ridgeline] WARN: sensor playwright failed: stubbed rejection")
      return []
    })

    const result = await executeBuildPhase(phase, config, makeState())
    expect(result).toBe("passed")
    expect(collectSensorFindings).toHaveBeenCalledTimes(1)
    expect(printWarn).toHaveBeenCalledWith(expect.stringContaining("sensor playwright failed"))
  })

  it("runs sensors only for suggestedSensors from detect", async () => {
    vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
    vi.mocked(runReviewer).mockResolvedValue({ result: makeResult(), verdict: passVerdict })
    vi.mocked(detect).mockResolvedValue({
      projectType: "node",
      isVisualSurface: false,
      detectedDeps: [],
      visualFileExts: [],
      hasDesignMd: false,
      hasAssetDir: false,
      suggestedSensors: [],
      suggestedEnsembleSize: 2,
    })

    await executeBuildPhase(phase, config, makeState())
    expect(collectSensorFindings).not.toHaveBeenCalled()
  })

  it("swallows detect() errors and continues the phase", async () => {
    vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
    vi.mocked(runReviewer).mockResolvedValue({ result: makeResult(), verdict: passVerdict })
    vi.mocked(detect).mockRejectedValue(new Error("detect blew up"))

    const result = await executeBuildPhase(phase, config, makeState())
    expect(result).toBe("passed")
  })

  it("passes builder-loop sensorFindings into the reviewer invocation", async () => {
    const finding = { kind: "a11y" as const, severity: "warning" as const, summary: "axe flagged a tabindex issue" }
    vi.mocked(runBuilderLoop).mockResolvedValue(makeReadyOutcome())
    vi.mocked(runReviewer).mockImplementation(async (_cfg, _phase, _tag, _cwd, sensorFindings) => {
      const verdict: ReviewVerdict = { ...passVerdict, sensorFindings: sensorFindings ?? [] }
      return { result: makeResult(), verdict }
    })
    vi.mocked(detect).mockResolvedValue({
      projectType: "web",
      isVisualSurface: true,
      detectedDeps: ["react"],
      visualFileExts: [],
      hasDesignMd: false,
      hasAssetDir: false,
      suggestedSensors: ["a11y"],
      suggestedEnsembleSize: 2,
    })
    vi.mocked(collectSensorFindings).mockResolvedValue([finding])

    const result = await executeBuildPhase(phase, config, makeState())
    expect(result).toBe("passed")
    const reviewerCall = vi.mocked(runReviewer).mock.calls[0]
    expect(reviewerCall[4]).toEqual([finding])
  })
})
