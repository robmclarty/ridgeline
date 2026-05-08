import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup.js"

vi.mock("../shape.js", () => ({
  runShape: vi.fn(async () => undefined),
  runShapeAuto: vi.fn(async () => undefined),
}))

vi.mock("../spec.js", () => ({
  runSpec: vi.fn(async () => undefined),
}))

vi.mock("../plan.js", () => ({
  runPlan: vi.fn(async () => undefined),
}))

vi.mock("../build.js", () => ({
  runBuild: vi.fn(async () => undefined),
}))

vi.mock("../../config.js", () => ({
  resolveBuildDir: vi.fn((buildName: string, _opts: unknown) =>
    path.join(process.cwd(), ".ridgeline", "builds", buildName),
  ),
  resolveConfig: vi.fn((buildName: string) => ({ buildName })),
}))

vi.mock("../../stores/settings.js", () => ({
  resolveSpecialistTimeoutSeconds: vi.fn(() => 600),
}))

vi.mock("../../ui/output.js", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
}))

import { runShape, runShapeAuto } from "../shape.js"
import { runSpec } from "../spec.js"
import { runPlan } from "../plan.js"
import { runBuild } from "../build.js"
import { runCreate } from "../create.js"

const baseOpts = {
  model: "opus",
  timeout: "10",
}

describe("commands/create", () => {
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
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("dispatches to runShape (interactive) when isAuto is false and shape is pending", async () => {
    await runCreate(buildName, { ...baseOpts, input: "Build something" })
    expect(runShape).toHaveBeenCalledTimes(1)
    expect(runShapeAuto).not.toHaveBeenCalled()
  })

  it("dispatches to runShapeAuto when isAuto is true and shape is pending", async () => {
    const ideaPath = path.join(tmpDir, "idea.md")
    fs.writeFileSync(ideaPath, "Build something detailed.")
    await runCreate(buildName, { ...baseOpts, input: ideaPath, isAuto: true })
    expect(runShapeAuto).toHaveBeenCalledTimes(1)
    expect(runShape).not.toHaveBeenCalled()
  })

  it("throws when isAuto is true and no input is provided for the shape stage", async () => {
    await expect(runCreate(buildName, { ...baseOpts, isAuto: true })).rejects.toThrow(/requires an input/)
  })

  it("dispatches to runSpec when shape is complete and spec is pending", async () => {
    fs.writeFileSync(path.join(buildDir, "shape.md"), "# Shape")
    await runCreate(buildName, baseOpts)
    expect(runSpec).toHaveBeenCalledTimes(1)
    expect(runShape).not.toHaveBeenCalled()
    expect(runShapeAuto).not.toHaveBeenCalled()
  })

  it("dispatches to runPlan when shape and spec complete and plan pending", async () => {
    fs.writeFileSync(path.join(buildDir, "shape.md"), "# Shape")
    fs.writeFileSync(path.join(buildDir, "spec.md"), "# Spec")
    fs.writeFileSync(path.join(buildDir, "constraints.md"), "# Constraints")
    await runCreate(buildName, baseOpts)
    expect(runPlan).toHaveBeenCalledTimes(1)
  })

  it("dispatches to runBuild when only build is pending", async () => {
    fs.writeFileSync(path.join(buildDir, "shape.md"), "# Shape")
    fs.writeFileSync(path.join(buildDir, "spec.md"), "# Spec")
    fs.writeFileSync(path.join(buildDir, "constraints.md"), "# Constraints")
    const phasesDir = path.join(buildDir, "phases")
    fs.mkdirSync(phasesDir, { recursive: true })
    fs.writeFileSync(path.join(phasesDir, "01-scaffold.md"), "# Phase 1")
    await runCreate(buildName, baseOpts)
    expect(runBuild).toHaveBeenCalledTimes(1)
  })

  it("isAuto is a no-op for spec/plan/build (same runner is called)", async () => {
    fs.writeFileSync(path.join(buildDir, "shape.md"), "# Shape")
    await runCreate(buildName, { ...baseOpts, isAuto: true })
    expect(runSpec).toHaveBeenCalledTimes(1)
  })

  it("persists inputSource when input is a file path", async () => {
    const ideaPath = path.join(tmpDir, "idea.md")
    fs.writeFileSync(ideaPath, "spec content")
    await runCreate(buildName, { ...baseOpts, input: ideaPath })
    const state = JSON.parse(fs.readFileSync(path.join(buildDir, "state.json"), "utf-8"))
    expect(state.inputSource).toBe(ideaPath)
  })

  it("does not persist inputSource when input is inline text", async () => {
    await runCreate(buildName, { ...baseOpts, input: "just a description string" })
    const statePath = path.join(buildDir, "state.json")
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, "utf-8"))
      expect(state.inputSource).toBeUndefined()
    }
  })
})
