import { execSync } from "node:child_process"
import * as path from "node:path"
import { printWarn } from "../ui/output.js"

const run = (cmd: string, cwd?: string): string =>
  execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim()

const worktreeDir = (buildName: string, phaseId: string, cwd?: string): string =>
  path.join(cwd ?? process.cwd(), ".ridgeline", "worktrees", buildName, phaseId)

const branchName = (buildName: string, phaseId: string): string =>
  `ridgeline/${buildName}/${phaseId}`

/**
 * Create an isolated git worktree for a parallel phase.
 * Returns the absolute path to the worktree directory.
 */
export const createPhaseWorktree = (buildName: string, phaseId: string, cwd?: string): string => {
  const wtPath = worktreeDir(buildName, phaseId, cwd)
  const branch = branchName(buildName, phaseId)
  run(`git worktree add "${wtPath}" -b "${branch}"`, cwd)
  return wtPath
}

/**
 * Merge a phase's worktree branch back into the current branch.
 * Must be called from the main working tree (not from inside a worktree).
 * Returns success status; on conflict, aborts the merge and returns conflict file list.
 */
export const mergePhaseWorktree = (
  buildName: string,
  phaseId: string,
  cwd?: string,
): { isSuccess: boolean; conflictFiles?: string[] } => {
  const branch = branchName(buildName, phaseId)
  try {
    run(`git merge --no-ff "${branch}" -m "ridgeline: merge ${phaseId}"`, cwd)
    return { isSuccess: true }
  } catch {
    // Collect conflict file list before aborting
    let conflictFiles: string[] = []
    try {
      const output = run("git diff --name-only --diff-filter=U", cwd)
      conflictFiles = output ? output.split("\n").filter(Boolean) : []
    } catch { /* ignore */ }

    try {
      run("git merge --abort", cwd)
    } catch { /* already clean */ }

    return { isSuccess: false, conflictFiles }
  }
}

/**
 * Remove a phase worktree and its branch. Idempotent — does not throw if already removed.
 */
export const removePhaseWorktree = (buildName: string, phaseId: string, cwd?: string): void => {
  const wtPath = worktreeDir(buildName, phaseId, cwd)
  const branch = branchName(buildName, phaseId)
  try { run(`git worktree remove "${wtPath}" --force`, cwd) } catch { /* already removed */ }
  try { run(`git branch -D "${branch}"`, cwd) } catch { /* already deleted */ }
}

/**
 * Clean up all worktrees and branches for a build. Called on error paths and after completion.
 */
export const cleanupAllWorktrees = (buildName: string, cwd?: string): void => {
  try { run("git worktree prune", cwd) } catch { /* ignore */ }

  // Delete all branches matching ridgeline/<buildName>/*
  try {
    const branches = run(`git branch --list "ridgeline/${buildName}/*"`, cwd)
    if (branches) {
      for (const branch of branches.split("\n").map((b) => b.trim()).filter(Boolean)) {
        try { run(`git branch -D "${branch}"`, cwd) } catch { /* ignore */ }
      }
    }
  } catch {
    printWarn(`Worktree cleanup: could not list branches for ${buildName}`)
  }
}
