import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup.js"

vi.mock("../../engine/pipeline/refine.exec.js", () => ({
  invokeRefiner: vi.fn(),
}))

vi.mock("../../stores/state.js", () => ({
  advancePipeline: vi.fn(),
}))

vi.mock("../../stores/trajectory.js", () => ({
  logTrajectory: vi.fn(),
}))

vi.mock("../../stores/budget.js", () => ({
  recordCost: vi.fn(),
}))

vi.mock("../../ui/output.js", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
}))

import { invokeRefiner } from "../../engine/pipeline/refine.exec.js"
import { advancePipeline } from "../../stores/state.js"
import { logTrajectory } from "../../stores/trajectory.js"
import { recordCost } from "../../stores/budget.js"
import { printError } from "../../ui/output.js"
import { runRefine } from "../refine.js"

const makeRefinerResult = () => ({
  success: true,
  result: "refined spec",
  durationMs: 5000,
  costUsd: 0.30,
  usage: { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  sessionId: "sess-1",
})

const defaultOpts = { model: "opus", timeout: 10 }

describe("commands/refine", () => {
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

    vi.mocked(invokeRefiner).mockResolvedValue(makeRefinerResult())
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("prints error when build directory does not exist", async () => {
    fs.rmSync(buildDir, { recursive: true, force: true })

    await runRefine(buildName, defaultOpts)

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("Build directory not found"))
  })

  it("prints error when spec.md is missing", async () => {
    fs.writeFileSync(path.join(buildDir, "research.md"), "research")
    fs.writeFileSync(path.join(buildDir, "constraints.md"), "constraints")

    await runRefine(buildName, defaultOpts)

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("spec.md not found"))
  })

  it("prints error when research.md is missing", async () => {
    fs.writeFileSync(path.join(buildDir, "spec.md"), "spec")
    fs.writeFileSync(path.join(buildDir, "constraints.md"), "constraints")

    await runRefine(buildName, defaultOpts)

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("research.md not found"))
  })

  it("prints error when constraints.md is missing", async () => {
    fs.writeFileSync(path.join(buildDir, "spec.md"), "spec")
    fs.writeFileSync(path.join(buildDir, "research.md"), "research")

    await runRefine(buildName, defaultOpts)

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("constraints.md not found"))
  })

  it("calls invokeRefiner with correct arguments", async () => {
    fs.writeFileSync(path.join(buildDir, "spec.md"), "spec content")
    fs.writeFileSync(path.join(buildDir, "research.md"), "research content")
    fs.writeFileSync(path.join(buildDir, "constraints.md"), "constraints content")

    await runRefine(buildName, defaultOpts)

    expect(invokeRefiner).toHaveBeenCalledTimes(1)
    const [specMd, researchMd, constraintsMd] = vi.mocked(invokeRefiner).mock.calls[0]
    expect(specMd).toBe("spec content")
    expect(researchMd).toBe("research content")
    expect(constraintsMd).toBe("constraints content")
  })

  it("records cost and trajectory", async () => {
    fs.writeFileSync(path.join(buildDir, "spec.md"), "spec")
    fs.writeFileSync(path.join(buildDir, "research.md"), "research")
    fs.writeFileSync(path.join(buildDir, "constraints.md"), "constraints")

    await runRefine(buildName, defaultOpts)

    expect(recordCost).toHaveBeenCalledWith(expect.stringContaining(buildName), "refine", "refiner", 0, expect.any(Object))
    expect(logTrajectory).toHaveBeenCalledWith(
      expect.stringContaining(buildName), "refine_start", null, expect.stringContaining("Refine started"),
    )
    expect(logTrajectory).toHaveBeenCalledWith(
      expect.stringContaining(buildName), "refine_complete", null,
      expect.stringContaining("Refine complete"),
      expect.objectContaining({ costUsd: expect.any(Number) }),
    )
  })

  it("calls advancePipeline with 'refine'", async () => {
    fs.writeFileSync(path.join(buildDir, "spec.md"), "spec")
    fs.writeFileSync(path.join(buildDir, "research.md"), "research")
    fs.writeFileSync(path.join(buildDir, "constraints.md"), "constraints")

    await runRefine(buildName, defaultOpts)

    expect(advancePipeline).toHaveBeenCalledWith(expect.stringContaining(buildName), buildName, "refine")
  })

  it("derives iteration number from existing changelog", async () => {
    fs.writeFileSync(path.join(buildDir, "spec.md"), "spec")
    fs.writeFileSync(path.join(buildDir, "research.md"), "research")
    fs.writeFileSync(path.join(buildDir, "constraints.md"), "constraints")
    fs.writeFileSync(path.join(buildDir, "spec.changelog.md"), "## Iteration 1\n\nChanges...\n\n## Iteration 2\n\nMore changes...")

    await runRefine(buildName, defaultOpts)

    // Should derive iteration 3 from 2 existing iterations
    const config = vi.mocked(invokeRefiner).mock.calls[0][4]
    expect(config.iterationNumber).toBe(3)
  })
})
