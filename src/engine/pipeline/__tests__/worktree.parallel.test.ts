import { describe, it, expect, afterEach } from "vitest"
import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { initTestRepo } from "../../../../test/setup.js"
import { createPhaseWorktree, mergePhaseWorktree, removePhaseWorktree, cleanupAllWorktrees } from "../worktree.parallel.js"

const run = (cmd: string, cwd: string) =>
  execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim()

const setupGitRepo = (): string => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "ridgeline-wt-test-"))
  initTestRepo(dir)
  fs.writeFileSync(path.join(dir, "file.txt"), "initial")
  run("git add -A && git commit -m 'initial'", dir)
  return dir
}

describe("worktree.parallel", () => {
  let repoDir: string

  afterEach(() => {
    if (repoDir) {
      // Clean up all worktrees before removing dir
      try { run("git worktree prune", repoDir) } catch { /* ignore */ }
      fs.rmSync(repoDir, { recursive: true, force: true })
    }
  })

  it("creates a worktree and branch for a phase", () => {
    repoDir = setupGitRepo()

    const wtPath = createPhaseWorktree("mybuild", "01-scaffold", repoDir)

    expect(fs.existsSync(wtPath)).toBe(true)
    expect(fs.existsSync(path.join(wtPath, "file.txt"))).toBe(true)
    // Branch should exist
    const branches = run("git branch", repoDir)
    expect(branches).toContain("ridgeline/mybuild/01-scaffold")

    removePhaseWorktree("mybuild", "01-scaffold", repoDir)
  })

  it("merges worktree changes back successfully", () => {
    repoDir = setupGitRepo()
    const wtPath = createPhaseWorktree("mybuild", "01-scaffold", repoDir)

    // Make changes in the worktree
    fs.writeFileSync(path.join(wtPath, "new-file.txt"), "from phase")
    run("git add -A && git commit -m 'phase work'", wtPath)

    // Remove worktree (required before merge)
    run(`git worktree remove "${wtPath}" --force`, repoDir)

    // Merge back
    const result = mergePhaseWorktree("mybuild", "01-scaffold", repoDir)
    expect(result.isSuccess).toBe(true)

    // Verify the file exists in main tree
    expect(fs.existsSync(path.join(repoDir, "new-file.txt"))).toBe(true)

    // Cleanup branch
    try { run('git branch -D "ridgeline/mybuild/01-scaffold"', repoDir) } catch { /* ignore */ }
  })

  it("handles merge conflicts gracefully", () => {
    repoDir = setupGitRepo()
    const wtPath = createPhaseWorktree("mybuild", "01-scaffold", repoDir)

    // Make conflicting changes in main
    fs.writeFileSync(path.join(repoDir, "file.txt"), "main change")
    run("git add -A && git commit -m 'main change'", repoDir)

    // Make conflicting changes in worktree
    fs.writeFileSync(path.join(wtPath, "file.txt"), "worktree change")
    run("git add -A && git commit -m 'worktree change'", wtPath)

    // Remove worktree before merge
    run(`git worktree remove "${wtPath}" --force`, repoDir)

    const result = mergePhaseWorktree("mybuild", "01-scaffold", repoDir)
    expect(result.isSuccess).toBe(false)

    // Cleanup
    try { run('git branch -D "ridgeline/mybuild/01-scaffold"', repoDir) } catch { /* ignore */ }
  })

  it("removePhaseWorktree is idempotent", () => {
    repoDir = setupGitRepo()

    // Should not throw even when nothing exists
    expect(() => removePhaseWorktree("mybuild", "nonexistent", repoDir)).not.toThrow()
  })

  it("cleanupAllWorktrees removes branches", () => {
    repoDir = setupGitRepo()
    createPhaseWorktree("mybuild", "01-scaffold", repoDir)
    removePhaseWorktree("mybuild", "01-scaffold", repoDir)

    // Branch may still exist after removePhaseWorktree
    cleanupAllWorktrees("mybuild", repoDir)

    const branches = run("git branch", repoDir)
    expect(branches).not.toContain("ridgeline/mybuild")
  })
})
