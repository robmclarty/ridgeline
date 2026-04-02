import * as fs from "node:fs"
import * as path from "node:path"
import { BudgetState, BudgetEntry, ClaudeResult } from "../types"

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
  fs.writeFileSync(budgetPath(buildDir), JSON.stringify(budget, null, 2) + "\n")
}

export const recordCost = (
  buildDir: string,
  phase: string,
  role: BudgetEntry["role"],
  attempt: number,
  result: ClaudeResult
): BudgetState => {
  const budget = loadBudget(buildDir)
  const entry: BudgetEntry = {
    phase,
    role,
    attempt,
    costUsd: result.costUsd,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    durationMs: result.durationMs,
    timestamp: new Date().toISOString(),
  }
  budget.entries.push(entry)
  budget.totalCostUsd = budget.entries.reduce((sum, e) => sum + e.costUsd, 0)
  saveBudget(buildDir, budget)
  return budget
}

export const getTotalCost = (buildDir: string): number =>
  loadBudget(buildDir).totalCostUsd
