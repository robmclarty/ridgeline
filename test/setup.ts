import { afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { execSync } from "node:child_process"

// Point `git init` at an empty template dir so it skips copying hook samples from the
// system git templates — some sandboxes (macOS greywall) block reading
// /Library/Developer/CommandLineTools/usr/share/git-core/templates and the copy would fail.
if (!process.env.GIT_TEMPLATE_DIR) {
  const emptyTemplateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-git-empty-template-"))
  process.env.GIT_TEMPLATE_DIR = emptyTemplateDir
  process.on("exit", () => {
    try { fs.rmSync(emptyTemplateDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })
}

// Provide a helper to create isolated temp directories for tests that touch the filesystem
export const makeTempDir = (): string => {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-test-"))
}

const separateGitDirs: string[] = []

// Initialise a git repo in `workDir` with its .git contents stored outside the work tree.
// Writing `.git/config` inside the work tree is blocked by some sandboxes; using
// `--separate-git-dir` puts the git data in an allowed temp path, and leaves a .git
// pointer file in the work tree that all subsequent git commands follow transparently.
export const initTestRepo = (workDir: string): void => {
  const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-gitdir-"))
  separateGitDirs.push(gitDir)
  execSync(`git init --separate-git-dir=${gitDir}`, { cwd: workDir, stdio: "pipe" })
  execSync("git config user.email test@test.com", { cwd: workDir, stdio: "pipe" })
  execSync("git config user.name Test", { cwd: workDir, stdio: "pipe" })
}

afterEach(() => {
  while (separateGitDirs.length > 0) {
    const gitDir = separateGitDirs.pop()!
    try { fs.rmSync(gitDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

// Clean up any temp dirs after each test if needed
const tempDirs: string[] = []

export const trackTempDir = (dir: string): string => {
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }
  tempDirs.length = 0
})
