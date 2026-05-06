import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { RidgelineConfig, PhaseInfo, BuildState, ClaudeResult, ReviewVerdict } from "../../../types"

vi.mock("../../../stores/tags", () => ({
  createCheckpoint: vi.fn(),
  createCompletionTag: vi.fn(() => "completion-tag"),
}))

vi.mock("../../../stores/budget", () => ({
  recordCost: vi.fn(() => ({ entries: [], totalCostUsd: 0.05 })),
  getTotalCost: vi.fn(() => 0.05),
}))

vi.mock("../../../stores/handoff", () => ({ ensureHandoffExists: vi.fn() }))
vi.mock("../../../stores/state", () => ({ updatePhaseStatus: vi.fn() }))
vi.mock("../../../ui/output", () => ({
  printPhase: vi.fn(),
  printWarn: vi.fn(),
}))
vi.mock("../../../stores/trajectory", () => ({ logTrajectory: vi.fn() }))
vi.mock("../build.exec", () => ({ invokeBuilder: vi.fn() }))
vi.mock("../review.exec", () => ({ invokeReviewer: vi.fn() }))
vi.mock("../../../stores/feedback.verdict", () => ({
  formatIssue: vi.fn((i: { description: string }) => i.description),
}))
vi.mock("../../../stores/feedback.io", () => ({
  writeFeedback: vi.fn(),
  archiveFeedback: vi.fn(),
}))
vi.mock("../../../git", () => ({
  isWorkingTreeDirty: vi.fn(() => false),
  commitAll: vi.fn(),
}))

vi.mock("../../detect", () => ({
  detect: vi.fn(),
}))

vi.mock("../sensors.collect", () => ({
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

import { runPhase } from "../phase.sequence"
import { invokeBuilder } from "../build.exec"
import { invokeReviewer } from "../review.exec"
import { detect } from "../../detect"
import { collectSensorFindings } from "../sensors.collect"
import { printWarn } from "../../../ui/output"

const makeResult = (): ClaudeResult => ({
  success: true,
  result: "done",
  durationMs: 1000,
  costUsd: 0.01,
  usage: { inputTokens: 10, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  sessionId: "sess",
})

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

describe("phase.sequence — sensor integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("phase still passes when a sensor rejects (non-fatal warning)", async () => {
    vi.mocked(invokeBuilder).mockResolvedValue(makeResult())
    vi.mocked(invokeReviewer).mockResolvedValue({ result: makeResult(), verdict: passVerdict })
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

    const result = await runPhase(phase, config, makeState())
    expect(result).toBe("passed")
    expect(collectSensorFindings).toHaveBeenCalledTimes(1)
    expect(printWarn).toHaveBeenCalledWith(expect.stringContaining("sensor playwright failed"))
  })

  it("runs sensors only for suggestedSensors from detect", async () => {
    vi.mocked(invokeBuilder).mockResolvedValue(makeResult())
    vi.mocked(invokeReviewer).mockResolvedValue({ result: makeResult(), verdict: passVerdict })
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

    await runPhase(phase, config, makeState())
    expect(collectSensorFindings).not.toHaveBeenCalled()
  })

  it("swallows detect() errors and continues the phase", async () => {
    vi.mocked(invokeBuilder).mockResolvedValue(makeResult())
    vi.mocked(invokeReviewer).mockResolvedValue({ result: makeResult(), verdict: passVerdict })
    vi.mocked(detect).mockRejectedValue(new Error("detect blew up"))

    const result = await runPhase(phase, config, makeState())
    expect(result).toBe("passed")
  })

  it("passes builder-loop sensorFindings into the reviewer invocation", async () => {
    const finding = { kind: "a11y" as const, severity: "warning" as const, summary: "axe flagged a tabindex issue" }
    vi.mocked(invokeBuilder).mockResolvedValue(makeResult())
    vi.mocked(invokeReviewer).mockImplementation(async (_cfg, _phase, _tag, _cwd, sensorFindings) => {
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

    const result = await runPhase(phase, config, makeState())
    expect(result).toBe("passed")
    const reviewerCall = vi.mocked(invokeReviewer).mock.calls[0]
    expect(reviewerCall[4]).toEqual([finding])
  })
})
