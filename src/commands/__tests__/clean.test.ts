import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { makeTempDir } from "../../../test/setup"

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
}))

import { runClean } from "../clean"

const initGitRepo = (dir: string): void => {
  execSync("git init", { cwd: dir, stdio: "pipe" })
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" })
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" })
  fs.writeFileSync(path.join(dir, "README.md"), "# Test")
  execSync("git add -A && git commit -m 'init'", { cwd: dir, stdio: "pipe" })
}

describe("commands/clean", () => {
  let repoDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    repoDir = makeTempDir()
    initGitRepo(repoDir)
  })

  afterEach(() => {
    try {
      execSync("git worktree prune", { cwd: repoDir, stdio: "pipe" })
    } catch {}
    fs.rmSync(repoDir, { recursive: true, force: true })
  })

  it("does nothing when no worktrees directory exists", () => {
    expect(() => runClean(repoDir)).not.toThrow()
  })

  it("removes existing worktrees and WIP branches", () => {
    const worktreesDir = path.join(repoDir, ".ridgeline", "worktrees")
    fs.mkdirSync(worktreesDir, { recursive: true })

    execSync(
      `git worktree add ${path.join(worktreesDir, "test-build")} -b ridgeline/wip/test-build`,
      { cwd: repoDir, stdio: "pipe" }
    )

    expect(fs.existsSync(path.join(worktreesDir, "test-build"))).toBe(true)

    runClean(repoDir)

    expect(fs.existsSync(path.join(worktreesDir, "test-build"))).toBe(false)
    const branches = execSync("git branch", { cwd: repoDir, encoding: "utf-8" })
    expect(branches).not.toContain("ridgeline/wip/test-build")
  })
})
