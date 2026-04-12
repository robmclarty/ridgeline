import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"

vi.mock("../../stores/state", () => ({
  getPipelineStatus: vi.fn(() => ({
    shape: "pending",
    design: "skipped",
    spec: "pending",
    research: "skipped",
    refine: "skipped",
    plan: "pending",
    build: "pending",
  })),
  getNextPipelineStage: vi.fn(() => "shape"),
}))

vi.mock("../../config", () => ({
  resolveBuildDir: vi.fn(),
  resolveConfig: vi.fn(() => ({
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
    checkCommand: null,
    maxBudgetUsd: null,
  })),
}))

vi.mock("../../engine/discovery/flavour.resolve", () => ({
  resolveFlavour: vi.fn(() => null),
}))

vi.mock("../../engine/discovery/flavour.config", () => ({
  loadFlavourConfig: vi.fn(() => ({ recommendedSkills: [] })),
}))

vi.mock("../../engine/discovery/skill.check", () => ({
  checkRecommendedSkills: vi.fn(() => []),
  formatSkillAvailability: vi.fn(() => null),
}))

vi.mock("../shape", () => ({
  runShape: vi.fn(),
}))

vi.mock("../spec", () => ({
  runSpec: vi.fn(),
}))

vi.mock("../plan", () => ({
  runPlan: vi.fn(),
}))

vi.mock("../build", () => ({
  runBuild: vi.fn(),
}))

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
}))

import { getNextPipelineStage } from "../../stores/state"
import { resolveBuildDir } from "../../config"
import { printInfo } from "../../ui/output"
import { runShape } from "../shape"
import { runSpec } from "../spec"
import { runPlan } from "../plan"
import { runBuild } from "../build"
import { runCreate } from "../create"

const defaultOpts = {
  model: "opus",
  timeout: "10",
}

describe("commands/create", () => {
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = makeTempDir()
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", "test-build")
    fs.mkdirSync(buildDir, { recursive: true })
    vi.mocked(resolveBuildDir).mockReturnValue(buildDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("prints 'All stages complete' when no next stage", async () => {
    vi.mocked(getNextPipelineStage).mockReturnValue(null)

    await runCreate("test-build", defaultOpts)

    expect(printInfo).toHaveBeenCalledWith("All stages complete.")
  })

  it("dispatches to runShape when next stage is shape", async () => {
    vi.mocked(getNextPipelineStage).mockReturnValue("shape")

    await runCreate("test-build", defaultOpts)

    expect(runShape).toHaveBeenCalledTimes(1)
  })

  it("dispatches to runSpec when next stage is spec", async () => {
    vi.mocked(getNextPipelineStage).mockReturnValue("spec")

    await runCreate("test-build", defaultOpts)

    expect(runSpec).toHaveBeenCalledTimes(1)
  })

  it("dispatches to runPlan when next stage is plan", async () => {
    vi.mocked(getNextPipelineStage).mockReturnValue("plan")

    await runCreate("test-build", defaultOpts)

    expect(runPlan).toHaveBeenCalledTimes(1)
  })

  it("dispatches to runBuild when next stage is build", async () => {
    vi.mocked(getNextPipelineStage).mockReturnValue("build")

    await runCreate("test-build", defaultOpts)

    expect(runBuild).toHaveBeenCalledTimes(1)
  })

  it("passes flavour through to child commands", async () => {
    vi.mocked(getNextPipelineStage).mockReturnValue("shape")

    await runCreate("test-build", { ...defaultOpts, flavour: "game-dev" })

    const shapeOpts = vi.mocked(runShape).mock.calls[0][1]
    expect(shapeOpts.flavour).toBe("game-dev")
  })
})
