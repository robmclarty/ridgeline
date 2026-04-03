import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

const run = (cmd: string, cwd?: string): string =>
  execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim()

export const worktreePath = (repoRoot: string, buildName: string): string =>
  path.join(repoRoot, ".ridgeline", "worktrees", buildName)

export const wipBranch = (buildName: string): string =>
  `ridgeline/wip/${buildName}`

export const createWorktree = (repoRoot: string, buildName: string): string => {
  const wtPath = worktreePath(repoRoot, buildName)
  const branch = wipBranch(buildName)

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(wtPath), { recursive: true })

  run(`git worktree add ${wtPath} -b ${branch}`, repoRoot)

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
