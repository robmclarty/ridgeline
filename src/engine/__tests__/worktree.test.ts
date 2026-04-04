import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { makeTempDir } from "../../../test/setup"
import {
  createWorktree,
  validateWorktree,
  reflectCommits,
  removeWorktree,
  worktreePath,
  wipBranch,
} from "../worktree"

const initGitRepo = (dir: string): void => {
  execSync("git init", { cwd: dir, stdio: "pipe" })
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" })
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" })
  fs.writeFileSync(path.join(dir, "README.md"), "# Test")
  execSync("git add -A && git commit -m 'init'", { cwd: dir, stdio: "pipe" })
}

describe("worktree", () => {
  let repoDir: string

  beforeEach(() => {
    repoDir = makeTempDir()
    initGitRepo(repoDir)
  })

  afterEach(() => {
    // Clean up worktrees before removing the repo
    try {
      execSync("git worktree prune", { cwd: repoDir, stdio: "pipe" })
    } catch {}
    fs.rmSync(repoDir, { recursive: true, force: true })
  })

  describe("worktreePath / wipBranch", () => {
    it("returns correct worktree path", () => {
      expect(worktreePath(repoDir, "my-build")).toBe(
        path.join(repoDir, ".ridgeline", "worktrees", "my-build")
      )
    })

    it("returns correct WIP branch name", () => {
      expect(wipBranch("my-build")).toBe("ridgeline/wip/my-build")
    })
  })

  describe("createWorktree", () => {
    it("creates a worktree directory with a WIP branch", () => {
      const wtPath = createWorktree(repoDir, "test-build")

      expect(fs.existsSync(wtPath)).toBe(true)
      expect(fs.existsSync(path.join(wtPath, "README.md"))).toBe(true)

      // Verify branch exists
      const branches = execSync("git branch", { cwd: repoDir, encoding: "utf-8" })
      expect(branches).toContain("ridgeline/wip/test-build")
    })

    it("reuses existing branch when branch already exists", () => {
      // Create and then remove the worktree, leaving the branch behind
      const wtPath = createWorktree(repoDir, "test-build")
      fs.rmSync(wtPath, { recursive: true, force: true })
      execSync("git worktree prune", { cwd: repoDir, stdio: "pipe" })

      // Branch still exists but worktree is gone — should reuse the branch
      const wtPath2 = createWorktree(repoDir, "test-build")
      expect(fs.existsSync(wtPath2)).toBe(true)

      const branches = execSync("git branch", { cwd: repoDir, encoding: "utf-8" })
      expect(branches).toContain("ridgeline/wip/test-build")
    })
  })

  describe("validateWorktree", () => {
    it("returns true for a valid worktree", () => {
      createWorktree(repoDir, "test-build")
      expect(validateWorktree(repoDir, "test-build")).toBe(true)
    })

    it("returns false when worktree directory does not exist", () => {
      expect(validateWorktree(repoDir, "nonexistent")).toBe(false)
    })

    it("returns false when worktree is corrupted", () => {
      const wtPath = createWorktree(repoDir, "test-build")
      // Corrupt it by removing .git
      fs.rmSync(path.join(wtPath, ".git"), { force: true })
      expect(validateWorktree(repoDir, "test-build")).toBe(false)
    })
  })

  describe("reflectCommits", () => {
    it("fast-forwards the source branch with worktree commits", () => {
      const wtPath = createWorktree(repoDir, "test-build")

      // Make a commit in the worktree
      fs.writeFileSync(path.join(wtPath, "new-file.ts"), "export const x = 1")
      execSync("git add -A && git commit -m 'add new file'", { cwd: wtPath, stdio: "pipe" })

      // Reflect back
      reflectCommits(repoDir, "test-build")

      // Verify the file appears in the main repo working tree
      expect(fs.existsSync(path.join(repoDir, "new-file.ts"))).toBe(true)
    })
  })

  describe("removeWorktree", () => {
    it("removes the worktree directory and WIP branch", () => {
      const wtPath = createWorktree(repoDir, "test-build")
      expect(fs.existsSync(wtPath)).toBe(true)

      removeWorktree(repoDir, "test-build")

      expect(fs.existsSync(wtPath)).toBe(false)
      const branches = execSync("git branch", { cwd: repoDir, encoding: "utf-8" })
      expect(branches).not.toContain("ridgeline/wip/test-build")
    })
  })
})
