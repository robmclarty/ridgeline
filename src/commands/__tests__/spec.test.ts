import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"

vi.mock("../../engine/pipeline/sketch.exec", () => ({
  invokeSpecEnsemble: vi.fn(),
}))

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
}))

vi.mock("../../store/state", () => ({
  advancePipeline: vi.fn(),
}))

import { invokeSpecEnsemble } from "../../engine/pipeline/sketch.exec"
import { printError } from "../../ui/output"
import { runSpec } from "../spec"

const defaultOpts = { model: "opus", timeout: 10 }

const makeEnsembleResult = () => ({
  specialistResults: [
    { success: true, result: "", durationMs: 1000, costUsd: 0.01, usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, sessionId: "s1" },
    { success: true, result: "", durationMs: 1000, costUsd: 0.01, usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, sessionId: "s2" },
  ],
  synthesizerResult: {
    success: true, result: "", durationMs: 2000, costUsd: 0.05,
    usage: { inputTokens: 500, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    sessionId: "synth",
  },
  totalCostUsd: 0.07,
  totalDurationMs: 3000,
})

describe("commands/spec", () => {
  let origCwd: string
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    origCwd = process.cwd()
    tmpDir = makeTempDir()
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("errors when shape.md does not exist", async () => {
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", "my-build")
    fs.mkdirSync(buildDir, { recursive: true })

    await runSpec("my-build", defaultOpts)

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("shape.md not found"))
    expect(invokeSpecEnsemble).not.toHaveBeenCalled()
  })

  it("reads shape.md and invokes ensemble", async () => {
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", "my-build")
    fs.mkdirSync(buildDir, { recursive: true })
    fs.writeFileSync(path.join(buildDir, "shape.md"), "# My Shape\n\n## Intent\nBuild a CLI")

    vi.mocked(invokeSpecEnsemble).mockImplementation(async () => {
      // Simulate specifier writing files
      fs.writeFileSync(path.join(buildDir, "spec.md"), "# Spec")
      fs.writeFileSync(path.join(buildDir, "constraints.md"), "# Constraints")
      return makeEnsembleResult()
    })

    await runSpec("my-build", defaultOpts)

    expect(invokeSpecEnsemble).toHaveBeenCalledTimes(1)
    const [shapeMd, config] = vi.mocked(invokeSpecEnsemble).mock.calls[0]
    expect(shapeMd).toContain("Build a CLI")
    expect(config.model).toBe("opus")
    expect(fs.realpathSync(config.buildDir)).toBe(fs.realpathSync(buildDir))
  })

  it("warns when spec.md is not created", async () => {
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", "my-build")
    fs.mkdirSync(buildDir, { recursive: true })
    fs.writeFileSync(path.join(buildDir, "shape.md"), "# Shape")

    vi.mocked(invokeSpecEnsemble).mockImplementation(async () => {
      fs.writeFileSync(path.join(buildDir, "constraints.md"), "# Constraints")
      return makeEnsembleResult()
    })

    await runSpec("my-build", defaultOpts)

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("spec.md was not created"))
  })

  it("warns when constraints.md is not created", async () => {
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", "my-build")
    fs.mkdirSync(buildDir, { recursive: true })
    fs.writeFileSync(path.join(buildDir, "shape.md"), "# Shape")

    vi.mocked(invokeSpecEnsemble).mockImplementation(async () => {
      fs.writeFileSync(path.join(buildDir, "spec.md"), "# Spec")
      return makeEnsembleResult()
    })

    await runSpec("my-build", defaultOpts)

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("constraints.md was not created"))
  })

  it("reports error when no spec files are created", async () => {
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", "my-build")
    fs.mkdirSync(buildDir, { recursive: true })
    fs.writeFileSync(path.join(buildDir, "shape.md"), "# Shape")

    vi.mocked(invokeSpecEnsemble).mockResolvedValue(makeEnsembleResult())

    await runSpec("my-build", defaultOpts)

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("No spec files were created"))
  })
})
