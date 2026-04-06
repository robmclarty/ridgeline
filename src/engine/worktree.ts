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

  // Remove untracked files that would conflict with the merge.
  // The WIP branch is authoritative, so its versions always win.
  // This commonly happens with package-lock.json, build metadata, etc.
  try {
    const untrackedRaw = run("git ls-files --others --exclude-standard", repoRoot)
    if (untrackedRaw) {
      const wipFiles = new Set(
        run(`git diff --name-only HEAD...${branch}`, repoRoot).split("\n").filter(Boolean),
      )
      for (const f of untrackedRaw.split("\n").filter(Boolean)) {
        if (wipFiles.has(f)) {
          fs.unlinkSync(path.join(repoRoot, f))
        }
      }
    }
  } catch {
    // best-effort — merge may still succeed without cleanup
  }

  // Stage and commit any remaining dirty files (e.g. modified tracked files)
  // so the merge doesn't fail on uncommitted changes.
  try {
    run("git add -A", repoRoot)
    run('git commit -m "ridgeline: stage pre-merge state"', repoRoot)
  } catch {
    // Nothing to commit — safe to ignore
  }

  try {
    // Try fast-forward first
    run(`git merge --ff-only ${branch}`, repoRoot)
  } catch {
    // Main diverged — rebase WIP onto main so builder work layers on top of user changes.
    // This preserves user edits (e.g. version bumps) while applying builder additions on top.
    const wtPath = worktreePath(repoRoot, buildName)
    try {
      run("git rebase main", wtPath)
    } catch {
      try { run("git rebase --abort", wtPath) } catch { /* best effort */ }
      throw new Error(
        `Cannot auto-merge: both main and the build modified the same lines.\n` +
        `Resolve manually in ${wtPath} and re-run.`
      )
    }
    // Rebase succeeded — now fast-forward main
    run(`git merge --ff-only ${branch}`, repoRoot)
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
