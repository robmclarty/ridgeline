import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"

vi.mock("../create", () => ({
  runCreate: vi.fn(async () => undefined),
  // The orchestrator imports persistInputSourceIfPath from create — provide a no-op
  // so tests can supply input file paths without hitting real fs/state machinery.
  persistInputSourceIfPath: vi.fn(),
}))

vi.mock("../directions", () => ({
  runDirectionsAuto: vi.fn(async () => undefined),
}))

vi.mock("../research", () => ({
  runResearch: vi.fn(async () => undefined),
}))

vi.mock("../retrospective", () => ({
  runRetrospective: vi.fn(async () => undefined),
}))

vi.mock("../retro-refine", () => ({
  runRetroRefine: vi.fn(async () => undefined),
}))

vi.mock("../../config", () => ({
  resolveBuildDir: vi.fn((buildName: string) =>
    path.join(process.cwd(), ".ridgeline", "builds", buildName),
  ),
}))

vi.mock("../../stores/settings", () => ({
  resolveSpecialistTimeoutSeconds: vi.fn(() => 600),
}))

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
  printWarn: vi.fn(),
}))

import { runCreate } from "../create"
import { runDirectionsAuto } from "../directions"
import { runResearch } from "../research"
import { runRetrospective } from "../retrospective"
import { runRetroRefine } from "../retro-refine"
import { runAuto } from "../auto"
import { recordMatchedShapes } from "../../stores/state"

const baseOpts = {
  model: "opus",
  timeout: "10",
}

const buildName = "test-build"

const writeArtifact = (buildDir: string, file: string, content: string): void => {
  fs.writeFileSync(path.join(buildDir, file), content)
}

const writeAllArtifactsThroughBuild = (buildDir: string): void => {
  // Make every required pipeline stage report "complete" via derivePipelineFromArtifacts.
  writeArtifact(buildDir, "shape.md", "# Shape")
  writeArtifact(buildDir, "design.md", "# Design")
  writeArtifact(buildDir, "spec.md", "# Spec")
  writeArtifact(buildDir, "constraints.md", "# Constraints")
  const phasesDir = path.join(buildDir, "phases")
  fs.mkdirSync(phasesDir, { recursive: true })
  fs.writeFileSync(path.join(phasesDir, "01-scaffold.md"), "# Phase 1")
  // build state needs explicit "complete" — write state.json directly.
  fs.writeFileSync(
    path.join(buildDir, "state.json"),
    JSON.stringify({
      buildName,
      startedAt: new Date().toISOString(),
      pipeline: {
        shape: "complete", design: "complete", spec: "complete",
        research: "skipped", refine: "skipped", plan: "complete", build: "complete",
      },
      phases: [],
    }, null, 2),
  )
}

describe("commands/auto", () => {
  let origCwd: string
  let tmpDir: string
  let buildDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    origCwd = process.cwd()
    tmpDir = makeTempDir()
    process.chdir(tmpDir)
    buildDir = path.join(tmpDir, ".ridgeline", "builds", buildName)
    fs.mkdirSync(buildDir, { recursive: true })

    // runCreate is mocked, so nothing advances the pipeline by default.
    // For loop tests we'll pre-create artifacts to simulate stage completion.
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("validates --stop-after value", async () => {
    writeArtifact(buildDir, "shape.md", "# Shape")
    await expect(
      runAuto(buildName, { ...baseOpts, stopAfter: "garbage" as never }),
    ).rejects.toThrow(/Invalid --stop-after/)
  })

  it("requires input or existing shape.md", async () => {
    await expect(runAuto(buildName, baseOpts)).rejects.toThrow(/requires an input argument/)
  })

  it("invokes runRetrospective and runRetroRefine after a complete pipeline", async () => {
    writeAllArtifactsThroughBuild(buildDir)
    await runAuto(buildName, baseOpts)
    expect(runRetrospective).toHaveBeenCalledTimes(1)
    expect(runRetroRefine).toHaveBeenCalledTimes(1)
  })

  it("skips runRetroRefine when isNoRefine is set", async () => {
    writeAllArtifactsThroughBuild(buildDir)
    await runAuto(buildName, { ...baseOpts, isNoRefine: true })
    expect(runRetrospective).toHaveBeenCalledTimes(1)
    expect(runRetroRefine).not.toHaveBeenCalled()
  })

  it("does not run retro hooks when stop-after halts before build", async () => {
    writeArtifact(buildDir, "shape.md", "# Shape")
    writeArtifact(buildDir, "spec.md", "# Spec")
    writeArtifact(buildDir, "constraints.md", "# Constraints")
    fs.writeFileSync(
      path.join(buildDir, "state.json"),
      JSON.stringify({
        buildName,
        startedAt: new Date().toISOString(),
        pipeline: {
          shape: "complete", design: "skipped", spec: "complete",
          research: "skipped", refine: "skipped", plan: "pending", build: "pending",
        },
        phases: [],
      }, null, 2),
    )
    await runAuto(buildName, { ...baseOpts, stopAfter: "spec" })
    expect(runRetrospective).not.toHaveBeenCalled()
    expect(runRetroRefine).not.toHaveBeenCalled()
  })

  it("inserts directions stage when --directions is set and shape is web-visual (next=spec)", async () => {
    // Shape complete, spec pending -> getNextPipelineStage returns "spec"
    writeArtifact(buildDir, "shape.md", "# Shape")
    recordMatchedShapes(buildDir, buildName, ["web-visual"])
    // Make runCreate a no-op so the loop doesn't run forever; cap is 16.
    vi.mocked(runCreate).mockImplementation(async () => {
      // Mark spec complete after first runCreate call so loop exits.
      writeArtifact(buildDir, "spec.md", "# Spec")
      writeArtifact(buildDir, "constraints.md", "# Constraints")
    })
    await runAuto(buildName, { ...baseOpts, directions: 3, inspiration: "some prompt", stopAfter: "spec" })
    expect(runDirectionsAuto).toHaveBeenCalledTimes(1)
    expect(runDirectionsAuto).toHaveBeenCalledWith(
      buildName,
      expect.objectContaining({ count: 3, inspiration: "some prompt" }),
    )
  })

  it("does not insert directions when shape has no visual match", async () => {
    writeArtifact(buildDir, "shape.md", "# Shape")
    recordMatchedShapes(buildDir, buildName, [])
    vi.mocked(runCreate).mockImplementation(async () => {
      writeArtifact(buildDir, "spec.md", "# Spec")
      writeArtifact(buildDir, "constraints.md", "# Constraints")
    })
    await runAuto(buildName, { ...baseOpts, directions: 3, stopAfter: "spec" })
    expect(runDirectionsAuto).not.toHaveBeenCalled()
  })

  it("inserts research+refine when --research is set and next=plan", async () => {
    // Shape, design, spec all complete; plan pending -> getNextPipelineStage returns "plan"
    writeArtifact(buildDir, "shape.md", "# Shape")
    writeArtifact(buildDir, "design.md", "# Design")
    writeArtifact(buildDir, "spec.md", "# Spec")
    writeArtifact(buildDir, "constraints.md", "# Constraints")
    vi.mocked(runCreate).mockImplementation(async () => {
      // Mark plan complete by writing a phase file.
      const phasesDir = path.join(buildDir, "phases")
      fs.mkdirSync(phasesDir, { recursive: true })
      fs.writeFileSync(path.join(phasesDir, "01-x.md"), "# Phase 1")
    })
    await runAuto(buildName, { ...baseOpts, research: 2, stopAfter: "plan" })
    expect(runResearch).toHaveBeenCalledTimes(1)
    expect(runResearch).toHaveBeenCalledWith(
      buildName,
      expect.objectContaining({ auto: 2, isQuick: false }),
    )
  })

  it("calls runCreate at least once when an input is provided and shape is pending", async () => {
    // For this test we want runCreate to "advance" by writing shape.md so
    // the loop terminates after one iteration.
    vi.mocked(runCreate).mockImplementation(async () => {
      writeAllArtifactsThroughBuild(buildDir)
    })
    const ideaPath = path.join(tmpDir, "idea.md")
    fs.writeFileSync(ideaPath, "the idea")
    await runAuto(buildName, { ...baseOpts, input: ideaPath })
    expect(runCreate).toHaveBeenCalled()
  })
})
