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
  abortStaleMerge,
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

    it("merges successfully when main repo has untracked files outside .ridgeline (e.g. package-lock.json)", () => {
      const wtPath = createWorktree(repoDir, "test-build")

      // Simulate an untracked package-lock.json in the main repo
      // (e.g. from npm install during planner setup)
      fs.writeFileSync(path.join(repoDir, "package-lock.json"), '{"lockfileVersion": 1}')

      // Simulate the builder also creating and committing package-lock.json in the worktree
      fs.writeFileSync(path.join(wtPath, "package-lock.json"), '{"lockfileVersion": 3}')
      fs.writeFileSync(path.join(wtPath, "index.ts"), "export const main = () => {}")
      execSync("git add -A && git commit -m 'phase work'", { cwd: wtPath, stdio: "pipe" })

      // This should NOT throw
      reflectCommits(repoDir, "test-build")

      // Verify the source file arrived in main
      expect(fs.existsSync(path.join(repoDir, "index.ts"))).toBe(true)
    })

    it("rebases WIP onto main when both sides made non-overlapping edits", () => {
      const wtPath = createWorktree(repoDir, "test-build")

      // Simulate user changing a version on main (non-overlapping with WIP work)
      const pkgMain = path.join(repoDir, "README.md")
      fs.writeFileSync(pkgMain, "# Test\n\nversion: 2.0")
      execSync("git add -A && git commit -m 'bump version'", { cwd: repoDir, stdio: "pipe" })

      // Simulate builder adding new content in the worktree
      fs.writeFileSync(path.join(wtPath, "src.ts"), "export const x = 1")
      execSync("git add -A && git commit -m 'add source'", { cwd: wtPath, stdio: "pipe" })

      // Should succeed via rebase — main's version bump preserved, WIP's file added
      reflectCommits(repoDir, "test-build")

      expect(fs.existsSync(path.join(repoDir, "src.ts"))).toBe(true)
      expect(fs.readFileSync(path.join(repoDir, "README.md"), "utf-8")).toBe("# Test\n\nversion: 2.0")
    })

    it("throws descriptive error when rebase has overlapping conflicts", () => {
      const wtPath = createWorktree(repoDir, "test-build")

      // Both sides modify the same line in README.md
      fs.writeFileSync(path.join(repoDir, "README.md"), "# Changed on main")
      execSync("git add -A && git commit -m 'main edit'", { cwd: repoDir, stdio: "pipe" })

      fs.writeFileSync(path.join(wtPath, "README.md"), "# Changed in WIP")
      execSync("git add -A && git commit -m 'wip edit'", { cwd: wtPath, stdio: "pipe" })

      expect(() => reflectCommits(repoDir, "test-build")).toThrow("Cannot auto-merge")
    })

    it("recovers from a stale in-progress merge and succeeds on retry", () => {
      const wtPath = createWorktree(repoDir, "test-build")

      // Add a new file in the worktree (no conflict)
      fs.writeFileSync(path.join(wtPath, "feature.ts"), "export const y = 2")
      execSync("git add -A && git commit -m 'add feature'", { cwd: wtPath, stdio: "pipe" })

      // Simulate a stale MERGE_HEAD to represent an interrupted merge
      const mergeHeadPath = path.join(repoDir, ".git", "MERGE_HEAD")
      const wipHead = execSync("git rev-parse HEAD", { cwd: wtPath, encoding: "utf-8" }).trim()
      fs.writeFileSync(mergeHeadPath, wipHead + "\n")

      // reflectCommits should abort the stale merge and succeed
      reflectCommits(repoDir, "test-build")

      expect(fs.existsSync(path.join(repoDir, "feature.ts"))).toBe(true)
      expect(fs.existsSync(mergeHeadPath)).toBe(false)
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

  describe("abortStaleMerge", () => {
    it("no-ops when there is no merge in progress", () => {
      expect(() => abortStaleMerge(repoDir)).not.toThrow()
    })

    it("aborts an active merge", () => {
      const wtPath = createWorktree(repoDir, "test-build")

      // Create a merge conflict on main
      fs.writeFileSync(path.join(repoDir, "README.md"), "# Changed on main")
      execSync("git add -A && git commit -m 'main edit'", { cwd: repoDir, stdio: "pipe" })

      fs.writeFileSync(path.join(wtPath, "README.md"), "# Changed in WIP")
      execSync("git add -A && git commit -m 'wip edit'", { cwd: wtPath, stdio: "pipe" })

      // Start a merge that will conflict
      try {
        execSync(`git merge ridgeline/wip/test-build`, { cwd: repoDir, stdio: "pipe" })
      } catch {
        // expected — conflict
      }

      // Verify merge is in progress
      const mergeHead = path.join(repoDir, ".git", "MERGE_HEAD")
      expect(fs.existsSync(mergeHead)).toBe(true)

      abortStaleMerge(repoDir)

      expect(fs.existsSync(mergeHead)).toBe(false)
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
