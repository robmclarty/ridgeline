import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { makeTempDir } from "../../../test/setup"
import { ensureGitRepo } from "../worktree"

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
    fs.rmSync(repoDir, { recursive: true, force: true })
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
})
