import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { makeTempDir } from "../../../test/setup"
import { generateSnapshot } from "../snapshot"

describe("snapshot", () => {
  let projectDir: string
  let buildDir: string

  beforeEach(() => {
    projectDir = makeTempDir()
    buildDir = makeTempDir()
    // Init a git repo so countSourceFiles works
    execSync("git init", { cwd: projectDir, stdio: "pipe" })
    execSync("git config user.email 'test@test.com'", { cwd: projectDir, stdio: "pipe" })
    execSync("git config user.name 'Test'", { cwd: projectDir, stdio: "pipe" })
  })

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true })
    fs.rmSync(buildDir, { recursive: true, force: true })
  })

  it("generates snapshot with directory tree", () => {
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true })
    fs.writeFileSync(path.join(projectDir, "src", "index.ts"), "export default {}")
    execSync("git add -A", { cwd: projectDir, stdio: "pipe" })

    const snapshot = generateSnapshot(projectDir, buildDir)
    expect(snapshot).toContain("## Directory Tree")
    expect(snapshot).toContain("src/")
    expect(snapshot).toContain("index.ts")
  })

  it("writes snapshot.md to buildDir", () => {
    generateSnapshot(projectDir, buildDir)
    expect(fs.existsSync(path.join(buildDir, "snapshot.md"))).toBe(true)
  })

  it("includes config files when present", () => {
    fs.writeFileSync(path.join(projectDir, "package.json"), '{"name": "test"}')
    execSync("git add -A", { cwd: projectDir, stdio: "pipe" })

    const snapshot = generateSnapshot(projectDir, buildDir)
    expect(snapshot).toContain("## Config Files")
    expect(snapshot).toContain("### package.json")
  })

  it("includes source file counts", () => {
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true })
    fs.writeFileSync(path.join(projectDir, "src", "a.ts"), "a")
    fs.writeFileSync(path.join(projectDir, "src", "b.ts"), "b")
    execSync("git add -A", { cwd: projectDir, stdio: "pipe" })

    const snapshot = generateSnapshot(projectDir, buildDir)
    expect(snapshot).toContain("## Source Files by Directory")
    expect(snapshot).toContain("src: 2 files")
  })

  it("excludes node_modules and other ignored directories from tree", () => {
    fs.mkdirSync(path.join(projectDir, "node_modules", "pkg"), { recursive: true })
    fs.writeFileSync(path.join(projectDir, "node_modules", "pkg", "index.js"), "")
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true })
    fs.writeFileSync(path.join(projectDir, "src", "app.ts"), "")

    const snapshot = generateSnapshot(projectDir, buildDir)
    // The directory tree section should exclude node_modules
    const treeSection = snapshot.split("## Config Files")[0]
    expect(treeSection).not.toContain("node_modules")
  })

  it("detects test directories", () => {
    fs.mkdirSync(path.join(projectDir, "test"), { recursive: true })
    fs.mkdirSync(path.join(projectDir, "__tests__"), { recursive: true })

    const snapshot = generateSnapshot(projectDir, buildDir)
    expect(snapshot).toContain("## Test Structure")
    expect(snapshot).toContain("test")
    expect(snapshot).toContain("__tests__")
  })
})
