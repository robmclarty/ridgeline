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
  ensureGitRepo,
  cleanAllWorktrees,
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
    it("merges successfully when main repo has untracked files that exist in WIP branch", () => {
      const wtPath = createWorktree(repoDir, "test-build")

      // Simulate ridgeline creating an untracked file in the main repo
      // (like ensureHandoffExists does)
      const buildDir = path.join(repoDir, ".ridgeline", "builds", "test-build")
      fs.mkdirSync(buildDir, { recursive: true })
      fs.writeFileSync(path.join(buildDir, "handoff.md"), "")

      // Simulate the builder writing the same file in the worktree
      const wtBuildDir = path.join(wtPath, ".ridgeline", "builds", "test-build")
      fs.mkdirSync(wtBuildDir, { recursive: true })
      fs.writeFileSync(path.join(wtBuildDir, "handoff.md"), "Phase 1 notes")

      // Also add a source file in the worktree
      fs.writeFileSync(path.join(wtPath, "new-file.ts"), "export const x = 1")

      // Commit in the worktree (like commitAll does)
      execSync("git add -A && git commit -m 'phase work'", { cwd: wtPath, stdio: "pipe" })

      // This should NOT throw — currently it does
      reflectCommits(repoDir, "test-build")

      // Verify the source file arrived in main
      expect(fs.existsSync(path.join(repoDir, "new-file.ts"))).toBe(true)
      // Verify handoff content came from the worktree branch
      expect(fs.readFileSync(path.join(repoDir, ".ridgeline", "builds", "test-build", "handoff.md"), "utf-8")).toBe("Phase 1 notes")
    })

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

  describe("ensureGitRepo", () => {
    it("returns false when directory is already a git repo with commits", () => {
      // repoDir was initialized in beforeEach
      expect(ensureGitRepo(repoDir)).toBe(false)
    })

    it("returns true and initializes repo when directory has no .git", () => {
      const freshDir = makeTempDir()
      // Write a file so there's something to commit
      fs.writeFileSync(path.join(freshDir, "index.ts"), "export {}")

      const result = ensureGitRepo(freshDir)

      expect(result).toBe(true)
      // Should have a commit now
      const log = execSync("git log --oneline", { cwd: freshDir, encoding: "utf-8" })
      expect(log).toContain("initial commit")

      fs.rmSync(freshDir, { recursive: true, force: true })
    })

    it("generates .gitignore with Node patterns when package.json exists", () => {
      const freshDir = makeTempDir()
      fs.writeFileSync(path.join(freshDir, "package.json"), "{}")

      ensureGitRepo(freshDir)

      const gitignore = fs.readFileSync(path.join(freshDir, ".gitignore"), "utf-8")
      expect(gitignore).toContain("node_modules/")

      fs.rmSync(freshDir, { recursive: true, force: true })
    })

    it("generates .gitignore with Python patterns when requirements.txt exists", () => {
      const freshDir = makeTempDir()
      fs.writeFileSync(path.join(freshDir, "requirements.txt"), "flask")

      ensureGitRepo(freshDir)

      const gitignore = fs.readFileSync(path.join(freshDir, ".gitignore"), "utf-8")
      expect(gitignore).toContain("__pycache__/")

      fs.rmSync(freshDir, { recursive: true, force: true })
    })

    it("does not overwrite existing .gitignore", () => {
      const freshDir = makeTempDir()
      fs.writeFileSync(path.join(freshDir, ".gitignore"), "my-custom-ignore")

      ensureGitRepo(freshDir)

      const gitignore = fs.readFileSync(path.join(freshDir, ".gitignore"), "utf-8")
      expect(gitignore).toBe("my-custom-ignore")

      fs.rmSync(freshDir, { recursive: true, force: true })
    })

    it("seeds initial commit when repo exists but has no commits", () => {
      const freshDir = makeTempDir()
      execSync("git init", { cwd: freshDir, stdio: "pipe" })
      fs.writeFileSync(path.join(freshDir, "app.ts"), "console.log('hi')")

      const result = ensureGitRepo(freshDir)

      expect(result).toBe(true)
      const log = execSync("git log --oneline", { cwd: freshDir, encoding: "utf-8" })
      expect(log).toContain("initial commit")

      fs.rmSync(freshDir, { recursive: true, force: true })
    })
  })

  describe("cleanAllWorktrees", () => {
    it("removes all worktree directories", () => {
      createWorktree(repoDir, "build-a")
      createWorktree(repoDir, "build-b")

      cleanAllWorktrees(repoDir)

      expect(fs.existsSync(worktreePath(repoDir, "build-a"))).toBe(false)
      expect(fs.existsSync(worktreePath(repoDir, "build-b"))).toBe(false)
    })

    it("no-ops when worktrees directory does not exist", () => {
      // No worktrees created — should not throw
      expect(() => cleanAllWorktrees(repoDir)).not.toThrow()
    })
  })
})
