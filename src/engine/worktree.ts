import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

const run = (cmd: string, cwd?: string): string =>
  execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim()

/**
 * Detect common project types from files in the repo root and return
 * a sensible .gitignore. Falls back to a minimal default.
 */
const generateGitignore = (repoRoot: string): string => {
  const exists = (f: string) => fs.existsSync(path.join(repoRoot, f))

  const lines: string[] = [
    "# Ridgeline",
    ".ridgeline/",
    "",
  ]

  if (exists("package.json")) {
    lines.push("# Node", "node_modules/", "dist/", "*.tgz", "")
  }
  if (exists("requirements.txt") || exists("pyproject.toml") || exists("setup.py")) {
    lines.push("# Python", "__pycache__/", "*.pyc", ".venv/", "venv/", "*.egg-info/", "")
  }
  if (exists("go.mod")) {
    lines.push("# Go", "/vendor/", "")
  }
  if (exists("Cargo.toml")) {
    lines.push("# Rust", "/target/", "")
  }

  lines.push(
    "# OS",
    ".DS_Store",
    "Thumbs.db",
    "",
    "# Editor",
    ".idea/",
    ".vscode/",
    "*.swp",
    "*.swo",
    "",
    "# Environment",
    ".env",
    ".env.local",
    "",
  )

  return lines.join("\n")
}

/**
 * Ensure the working directory is a git repo with at least one commit.
 * If not, initialise one with a generated .gitignore and root commit.
 * Returns true if a new repo was created, false if one already existed.
 */
const seedInitialCommit = (repoRoot: string): void => {
  const gitignorePath = path.join(repoRoot, ".gitignore")
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, generateGitignore(repoRoot))
  }
  run("git add -A", repoRoot)
  run('git commit -m "initial commit"', repoRoot)
}

export const ensureGitRepo = (repoRoot: string): boolean => {
  try {
    run("git rev-parse --git-dir", repoRoot)
    try {
      run("git rev-parse HEAD", repoRoot)
      return false
    } catch {
      seedInitialCommit(repoRoot)
      return true
    }
  } catch {
    run("git init", repoRoot)
    seedInitialCommit(repoRoot)
    return true
  }
}
