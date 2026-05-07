import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../../test/setup.js"
import { makeConfig } from "../../../../test/factories.js"

vi.mock("../../../ui/output.js", () => ({
  printError: vi.fn(),
}))

import { assembleBaseUserPrompt } from "../plan.exec.js"

describe("assembleBaseUserPrompt", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("includes spec content under ## spec.md header", () => {
    fs.writeFileSync(path.join(tmpDir, "spec.md"), "Build a CLI tool")
    fs.writeFileSync(path.join(tmpDir, "constraints.md"), "Use TypeScript")

    const result = assembleBaseUserPrompt(makeConfig({
      buildDir: tmpDir,
      constraintsPath: path.join(tmpDir, "constraints.md"),
    }))

    expect(result).toContain("## spec.md")
    expect(result).toContain("Build a CLI tool")
  })

  it("includes constraints section", () => {
    fs.writeFileSync(path.join(tmpDir, "spec.md"), "spec")
    fs.writeFileSync(path.join(tmpDir, "constraints.md"), "Must be fast")

    const result = assembleBaseUserPrompt(makeConfig({
      buildDir: tmpDir,
      constraintsPath: path.join(tmpDir, "constraints.md"),
    }))

    expect(result).toContain("## constraints.md")
    expect(result).toContain("Must be fast")
  })

  it("includes target model section", () => {
    fs.writeFileSync(path.join(tmpDir, "spec.md"), "spec")
    fs.writeFileSync(path.join(tmpDir, "constraints.md"), "constraints")

    const result = assembleBaseUserPrompt(makeConfig({
      buildDir: tmpDir,
      constraintsPath: path.join(tmpDir, "constraints.md"),
      model: "sonnet",
    }))

    expect(result).toContain("## Target Model")
    expect(result).toContain("`sonnet`")
  })

  it("includes taste section when tastePath is set", () => {
    fs.writeFileSync(path.join(tmpDir, "spec.md"), "spec")
    fs.writeFileSync(path.join(tmpDir, "constraints.md"), "constraints")
    fs.writeFileSync(path.join(tmpDir, "taste.md"), "Prefer functional style")

    const result = assembleBaseUserPrompt(makeConfig({
      buildDir: tmpDir,
      constraintsPath: path.join(tmpDir, "constraints.md"),
      tastePath: path.join(tmpDir, "taste.md"),
    }))

    expect(result).toContain("## taste.md")
    expect(result).toContain("Prefer functional style")
  })

  it("includes extra context when set", () => {
    fs.writeFileSync(path.join(tmpDir, "spec.md"), "spec")
    fs.writeFileSync(path.join(tmpDir, "constraints.md"), "constraints")

    const result = assembleBaseUserPrompt(makeConfig({
      buildDir: tmpDir,
      constraintsPath: path.join(tmpDir, "constraints.md"),
      extraContext: "This is a monorepo",
    }))

    expect(result).toContain("## Additional Context")
    expect(result).toContain("This is a monorepo")
  })

  it("omits taste and extra context when not set", () => {
    fs.writeFileSync(path.join(tmpDir, "spec.md"), "spec")
    fs.writeFileSync(path.join(tmpDir, "constraints.md"), "constraints")

    const result = assembleBaseUserPrompt(makeConfig({
      buildDir: tmpDir,
      constraintsPath: path.join(tmpDir, "constraints.md"),
      tastePath: null,
      extraContext: null,
    }))

    expect(result).not.toContain("## taste.md")
    expect(result).not.toContain("## Additional Context")
  })
})
