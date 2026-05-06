import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../sensors.collect", () => ({
  collectSensorFindings: vi.fn(async () => []),
}))
vi.mock("../../detect", () => ({
  detect: vi.fn(async () => ({
    projectType: "node",
    isVisualSurface: false,
    detectedDeps: [],
    visualFileExts: [],
    hasDesignMd: false,
    hasAssetDir: false,
    suggestedSensors: [],
    suggestedEnsembleSize: 2,
  })),
}))
vi.mock("../../../stores/tags", () => ({
  createCheckpoint: vi.fn(),
  createCompletionTag: vi.fn(() => "ridgeline/phase/b/p"),
}))
vi.mock("../../../stores/budget", () => ({
  recordCost: vi.fn(() => ({ entries: [], totalCostUsd: 0.1 })),
  getTotalCost: vi.fn(() => 0.1),
  getPhaseCostUsd: vi.fn(() => 0),
}))
vi.mock("../../../stores/handoff", () => ({
  ensureHandoffExists: vi.fn(),
  ensurePhaseHandoffExists: vi.fn(),
}))
vi.mock("../../../stores/state", () => ({
  updatePhaseStatus: vi.fn(),
}))
vi.mock("../../../ui/output", () => ({
  printPhase: vi.fn(),
  printWarn: vi.fn(),
}))
vi.mock("../build.exec", () => ({
  assembleUserPrompt: vi.fn(() => "stub user prompt"),
  invokeBuilder: vi.fn(async () => ({
    success: true,
    result: "done\nREADY_FOR_REVIEW",
    durationMs: 5000,
    costUsd: 0.03,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 512,
      cacheCreationInputTokens: 128,
    },
    sessionId: "sess",
  })),
}))
vi.mock("../review.exec", () => ({
  invokeReviewer: vi.fn(async () => ({
    result: {
      success: true,
      result: "ok",
      durationMs: 3000,
      costUsd: 0.02,
      usage: {
        inputTokens: 60,
        outputTokens: 30,
        cacheReadInputTokens: 256,
        cacheCreationInputTokens: 64,
      },
      sessionId: "sess",
    },
    verdict: { passed: true, summary: "ok", criteriaResults: [], issues: [], suggestions: [], sensorFindings: [] },
  })),
}))
vi.mock("../../../stores/feedback.verdict", () => ({ formatIssue: vi.fn() }))
vi.mock("../../../stores/feedback.io", () => ({ writeFeedback: vi.fn(), archiveFeedback: vi.fn() }))
vi.mock("../../../git", () => ({
  isWorkingTreeDirty: vi.fn(() => false),
  commitAll: vi.fn(),
}))

import { runPhase } from "../phase.sequence"
import { readTrajectory } from "../../../stores/trajectory"
import type { PhaseInfo, BuildState, RidgelineConfig } from "../../../types"

const makeState = (): BuildState => ({
  buildName: "b",
  startedAt: "",
  pipeline: { shape: "complete", design: "skipped", spec: "complete", research: "skipped", refine: "skipped", plan: "complete", build: "running" },
  phases: [{
    id: "01-p",
    status: "pending",
    checkpointTag: "chk",
    completionTag: null,
    retries: 0,
    duration: null,
    completedAt: null,
    failedAt: null,
  }],
})

const makePhase = (): PhaseInfo => ({
  id: "01-p",
  index: 1,
  slug: "p",
  filename: "01-p.md",
  filepath: "/does/not/matter",
  dependsOn: [],
})

describe("phase.sequence cache-token logging", () => {
  let buildDir: string

  beforeEach(() => {
    buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-cache-tokens-"))
  })

  afterEach(() => {
    fs.rmSync(buildDir, { recursive: true, force: true })
  })

  it("build_complete and review_complete include cacheRead/Creation input tokens", async () => {
    const config: RidgelineConfig = {
      buildName: "b",
      ridgelineDir: path.join(buildDir, ".ridgeline"),
      buildDir,
      constraintsPath: "/dev/null",
      tastePath: null,
      handoffPath: path.join(buildDir, "handoff.md"),
      phasesDir: path.join(buildDir, "phases"),
      model: "opus",
      maxRetries: 2,
      timeoutMinutes: 10,
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
    const state = makeState()
    const phase = makePhase()

    const outcome = await runPhase(phase, config, state)
    expect(outcome).toBe("passed")

    const entries = readTrajectory(buildDir)
    const buildComplete = entries.find((e) => e.type === "build_complete")
    expect(buildComplete).toBeDefined()
    expect(buildComplete?.cacheReadInputTokens).toBe(512)
    expect(buildComplete?.cacheCreationInputTokens).toBe(128)

    const reviewComplete = entries.find((e) => e.type === "review_complete")
    expect(reviewComplete).toBeDefined()
    expect(reviewComplete?.cacheReadInputTokens).toBe(256)
    expect(reviewComplete?.cacheCreationInputTokens).toBe(64)
  })
})
