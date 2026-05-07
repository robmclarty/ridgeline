import * as fs from "node:fs"
import * as path from "node:path"
import { BudgetState, BudgetEntry, ClaudeResult } from "../types"
import { atomicWriteSync } from "../utils/atomic-write"
import { withFileLock } from "../utils/file-lock"

const budgetPath = (buildDir: string): string =>
  path.join(buildDir, "budget.json")

export const loadBudget = (buildDir: string): BudgetState => {
  const fp = budgetPath(buildDir)
  if (fs.existsSync(fp)) {
    return JSON.parse(fs.readFileSync(fp, "utf-8"))
  }
  return { entries: [], totalCostUsd: 0 }
}

export const saveBudget = (buildDir: string, budget: BudgetState): void => {
  atomicWriteSync(budgetPath(buildDir), JSON.stringify(budget, null, 2) + "\n")
}

export const makeBudgetEntry = (
  phase: string,
  role: BudgetEntry["role"],
  attempt: number,
  result: ClaudeResult,
): BudgetEntry => ({
  phase,
  role,
  attempt,
  costUsd: result.costUsd,
  inputTokens: result.usage.inputTokens,
  outputTokens: result.usage.outputTokens,
  cacheReadInputTokens: result.usage.cacheReadInputTokens,
  cacheCreationInputTokens: result.usage.cacheCreationInputTokens,
  durationMs: result.durationMs,
  timestamp: new Date().toISOString(),
})

// Low-level append: persists one pre-formed entry under the file lock.
// Reused by the ridgeline_budget_subscriber adapter so the on-disk format stays
// owned by this module while the call site can reach disk via ctx.trajectory.
export const appendBudgetEntry = (buildDir: string, entry: BudgetEntry): BudgetState => {
  const lockPath = budgetPath(buildDir) + ".lock"
  return withFileLock(lockPath, () => {
    const budget = loadBudget(buildDir)
    budget.entries.push(entry)
    budget.totalCostUsd = budget.entries.reduce((sum, e) => sum + e.costUsd, 0)
    saveBudget(buildDir, budget)
    return budget
  })
}

export const recordCost = (
  buildDir: string,
  phase: string,
  role: BudgetEntry["role"],
  attempt: number,
  result: ClaudeResult
): BudgetState => {
  return appendBudgetEntry(buildDir, makeBudgetEntry(phase, role, attempt, result))
}

export const getTotalCost = (buildDir: string): number =>
  loadBudget(buildDir).totalCostUsd

/** Sum the costUsd of every entry tagged with `phaseId`. Used by the builder loop's phase-cost cap. */
export const getPhaseCostUsd = (buildDir: string, phaseId: string): number => {
  const budget = loadBudget(buildDir)
  return budget.entries.reduce((sum, e) => (e.phase === phaseId ? sum + e.costUsd : sum), 0)
}
