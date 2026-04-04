import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

const run = (cmd: string, cwd?: string): string =>
  execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim()

export const worktreePath = (repoRoot: string, buildName: string): string =>
  path.join(repoRoot, ".ridgeline", "worktrees", buildName)

export const wipBranch = (buildName: string): string =>
  `ridgeline/wip/${buildName}`

/**
 * Detect common project types from files in the repo root and return
 * a sensible .gitignore. Falls back to a minimal default.
 */
const generateGitignore = (repoRoot: string): string => {
  const exists = (f: string) => fs.existsSync(path.join(repoRoot, f))

  const lines: string[] = [
    "# Ridgeline",
    ".ridgeline/worktrees/",
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
export const ensureGitRepo = (repoRoot: string): boolean => {
  try {
    run("git rev-parse --git-dir", repoRoot)
    // Git repo exists — check for at least one commit (HEAD must be valid)
    try {
      run("git rev-parse HEAD", repoRoot)
      return false
    } catch {
      // Repo exists but no commits — create initial commit
      const gitignorePath = path.join(repoRoot, ".gitignore")
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, generateGitignore(repoRoot))
      }
      run("git add -A", repoRoot)
      run('git commit -m "initial commit"', repoRoot)
      return true
    }
  } catch {
    // Not a git repo — initialise
    run("git init", repoRoot)
    const gitignorePath = path.join(repoRoot, ".gitignore")
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, generateGitignore(repoRoot))
    }
    run("git add -A", repoRoot)
    run('git commit -m "initial commit"', repoRoot)
    return true
  }
}

export const createWorktree = (repoRoot: string, buildName: string): string => {
  const wtPath = worktreePath(repoRoot, buildName)
  const branch = wipBranch(buildName)

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(wtPath), { recursive: true })

  // Prune stale worktree entries (e.g., from a previous crash) so git
  // doesn't think the branch is still checked out elsewhere.
  try { run("git worktree prune", repoRoot) } catch { /* best effort */ }

  try {
    // Happy path: create a fresh branch
    run(`git worktree add ${wtPath} -b ${branch}`, repoRoot)
  } catch {
    // Branch already exists — reuse it
    try {
      run(`git worktree add ${wtPath} ${branch}`, repoRoot)
    } catch {
      // Corrupt state — force-delete the branch and retry
      try { run(`git branch -D ${branch}`, repoRoot) } catch { /* best effort */ }
      run(`git worktree add ${wtPath} -b ${branch}`, repoRoot)
    }
  }

  return wtPath
}

export const validateWorktree = (repoRoot: string, buildName: string): boolean => {
  const wtPath = worktreePath(repoRoot, buildName)

  if (!fs.existsSync(wtPath)) return false

  // Check if .git file/dir exists (worktrees have a .git file pointing to main repo)
  const gitPath = path.join(wtPath, ".git")
  if (!fs.existsSync(gitPath)) return false

  // Check if HEAD is valid
  try {
    run("git rev-parse HEAD", wtPath)
    return true
  } catch {
    return false
  }
}

export const reflectCommits = (repoRoot: string, buildName: string): void => {
  const branch = wipBranch(buildName)

  // Stage any untracked build metadata so git merge doesn't conflict
  // with files the WIP branch also committed (e.g. handoff.md).
  const buildMetaDir = path.join(".ridgeline", "builds", buildName)
  const absBuildMetaDir = path.join(repoRoot, buildMetaDir)
  if (fs.existsSync(absBuildMetaDir)) {
    try {
      run(`git add "${buildMetaDir}"`, repoRoot)
      run('git commit -m "ridgeline: stage build metadata"', repoRoot)
    } catch {
      // Nothing to commit or dir not found — safe to ignore
    }
  }

  try {
    // Try fast-forward first
    run(`git merge --ff-only ${branch}`, repoRoot)
  } catch {
    // Fall back to regular merge if user's branch diverged
    run(`git merge ${branch} -m "ridgeline: merge ${buildName} phase"`, repoRoot)
  }
}

export const removeWorktree = (repoRoot: string, buildName: string): void => {
  const wtPath = worktreePath(repoRoot, buildName)
  const branch = wipBranch(buildName)

  try {
    run(`git worktree remove ${wtPath} --force`, repoRoot)
  } catch {
    // If worktree remove fails, try manual cleanup
    if (fs.existsSync(wtPath)) {
      fs.rmSync(wtPath, { recursive: true, force: true })
    }
    try {
      run("git worktree prune", repoRoot)
    } catch {
      // best effort
    }
  }

  try {
    run(`git branch -d ${branch}`, repoRoot)
  } catch {
    try {
      run(`git branch -D ${branch}`, repoRoot)
    } catch {
      // best effort
    }
  }
}

export const cleanAllWorktrees = (repoRoot: string): void => {
  const worktreesDir = path.join(repoRoot, ".ridgeline", "worktrees")
  if (!fs.existsSync(worktreesDir)) return

  const entries = fs.readdirSync(worktreesDir)
  for (const entry of entries) {
    const fullPath = path.join(worktreesDir, entry)
    if (fs.statSync(fullPath).isDirectory()) {
      removeWorktree(repoRoot, entry)
    }
  }
}
