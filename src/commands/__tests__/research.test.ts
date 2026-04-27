import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"

vi.mock("../../engine/pipeline/research.exec", () => ({
  invokeResearcher: vi.fn(),
}))

vi.mock("../../stores/state", () => ({
  advancePipeline: vi.fn(),
}))

vi.mock("../../stores/trajectory", () => ({
  logTrajectory: vi.fn(),
}))

vi.mock("../../stores/budget", () => ({
  recordCost: vi.fn(),
}))

vi.mock("../../stores/settings", () => ({
  resolveResearchAllowlist: vi.fn(() => []),
  DEFAULT_SPECIALIST_TIMEOUT_SECONDS: 600,
  DEFAULT_SPECIALIST_COUNT: 3,
}))

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
}))

vi.mock("../refine", () => ({
  runRefine: vi.fn(),
}))

import { invokeResearcher } from "../../engine/pipeline/research.exec"
import { advancePipeline } from "../../stores/state"
import { logTrajectory } from "../../stores/trajectory"
import { recordCost } from "../../stores/budget"
import { printError } from "../../ui/output"
import { runResearch } from "../research"

const makeResult = () => ({
  success: true,
  result: "research findings",
  durationMs: 5000,
  costUsd: 0.50,
  usage: { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  sessionId: "sess-1",
})

const makeEnsembleResult = () => ({
  specialistNames: ["academic", "ecosystem"],
  specialistResults: [makeResult(), makeResult()],
  synthesizerResult: makeResult(),
  totalCostUsd: 1.50,
  totalDurationMs: 15000,
})

const defaultOpts = {
  model: "opus",
  timeout: 15,
  isQuick: false,
  auto: null as number | null,
}

describe("commands/research", () => {
  let origCwd: string
  let tmpDir: string
  let buildDir: string
  const buildName = "test-build"

  beforeEach(() => {
    vi.clearAllMocks()
    origCwd = process.cwd()
    tmpDir = makeTempDir()
    process.chdir(tmpDir)

    buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })

    vi.mocked(invokeResearcher).mockResolvedValue(makeEnsembleResult())
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("prints error when build directory does not exist", async () => {
    fs.rmSync(buildDir, { recursive: true, force: true })

    await runResearch(buildName, defaultOpts)

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("Build directory not found"))
  })

  it("prints error when spec.md is missing", async () => {
    fs.writeFileSync(path.join(buildDir, "constraints.md"), "constraints")

    await runResearch(buildName, defaultOpts)

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("spec.md not found"))
  })

  it("prints error when constraints.md is missing", async () => {
    fs.writeFileSync(path.join(buildDir, "spec.md"), "spec content")

    await runResearch(buildName, defaultOpts)

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("constraints.md not found"))
  })

  it("calls invokeResearcher with correct config", async () => {
    fs.writeFileSync(path.join(buildDir, "spec.md"), "spec content")
    fs.writeFileSync(path.join(buildDir, "constraints.md"), "constraints")

    await runResearch(buildName, defaultOpts)

    expect(invokeResearcher).toHaveBeenCalledTimes(1)
    const [specMd, constraintsMd] = vi.mocked(invokeResearcher).mock.calls[0]
    expect(specMd).toBe("spec content")
    expect(constraintsMd).toBe("constraints")
  })

  it("records costs for each specialist and synthesizer", async () => {
    fs.writeFileSync(path.join(buildDir, "spec.md"), "spec")
    fs.writeFileSync(path.join(buildDir, "constraints.md"), "constraints")

    await runResearch(buildName, defaultOpts)

    // 2 specialists + 1 synthesizer = 3 recordCost calls
    expect(recordCost).toHaveBeenCalledTimes(3)
    expect(recordCost).toHaveBeenCalledWith(expect.stringContaining(buildName), "research", "researcher", 0, expect.any(Object))
    expect(recordCost).toHaveBeenCalledWith(expect.stringContaining(buildName), "research", "researcher", 1, expect.any(Object))
    expect(recordCost).toHaveBeenCalledWith(expect.stringContaining(buildName), "research", "synthesizer", 0, expect.any(Object))
  })

  it("calls advancePipeline with 'research'", async () => {
    fs.writeFileSync(path.join(buildDir, "spec.md"), "spec")
    fs.writeFileSync(path.join(buildDir, "constraints.md"), "constraints")

    await runResearch(buildName, defaultOpts)

    expect(advancePipeline).toHaveBeenCalledWith(expect.stringContaining(buildName), buildName, "research")
  })

  it("logs trajectory start and complete entries", async () => {
    fs.writeFileSync(path.join(buildDir, "spec.md"), "spec")
    fs.writeFileSync(path.join(buildDir, "constraints.md"), "constraints")

    await runResearch(buildName, defaultOpts)

    expect(logTrajectory).toHaveBeenCalledWith(
      expect.stringContaining(buildName), "research_start", null, expect.stringContaining("Research started"),
    )
    expect(logTrajectory).toHaveBeenCalledWith(
      expect.stringContaining(buildName), "research_complete", null,
      expect.stringContaining("Research complete"),
      expect.objectContaining({ duration: expect.any(Number), costUsd: expect.any(Number) }),
    )
  })
})
