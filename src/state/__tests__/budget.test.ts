import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import { loadBudget, saveBudget, recordCost, getTotalCost } from "../budget"
import type { ClaudeResult, BudgetState } from "../../types"

const makeClaudeResult = (cost: number, inputTokens = 100, outputTokens = 50): ClaudeResult => ({
  success: true,
  result: "ok",
  durationMs: 5000,
  costUsd: cost,
  usage: {
    inputTokens,
    outputTokens,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  },
  sessionId: "test-session",
})

describe("budget", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe("loadBudget", () => {
    it("returns empty budget when no file exists", () => {
      const budget = loadBudget(tmpDir)
      expect(budget.entries).toEqual([])
      expect(budget.totalCostUsd).toBe(0)
    })

    it("loads existing budget file", () => {
      const budget: BudgetState = {
        entries: [{
          phase: "01-scaffold",
          role: "builder",
          attempt: 0,
          costUsd: 0.10,
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 5000,
          timestamp: "2024-01-01T00:00:00.000Z",
        }],
        totalCostUsd: 0.10,
      }
      fs.writeFileSync(path.join(tmpDir, "budget.json"), JSON.stringify(budget))

      const loaded = loadBudget(tmpDir)
      expect(loaded.entries).toHaveLength(1)
      expect(loaded.totalCostUsd).toBe(0.10)
    })
  })

  describe("saveBudget", () => {
    it("writes budget to file", () => {
      const budget: BudgetState = { entries: [], totalCostUsd: 0 }
      saveBudget(tmpDir, budget)

      const content = fs.readFileSync(path.join(tmpDir, "budget.json"), "utf-8")
      expect(JSON.parse(content)).toEqual(budget)
    })
  })

  describe("recordCost", () => {
    it("adds an entry and updates total", () => {
      const result = makeClaudeResult(0.25)
      const budget = recordCost(tmpDir, "01-scaffold", "builder", 0, result)

      expect(budget.entries).toHaveLength(1)
      expect(budget.entries[0].phase).toBe("01-scaffold")
      expect(budget.entries[0].role).toBe("builder")
      expect(budget.entries[0].costUsd).toBe(0.25)
      expect(budget.totalCostUsd).toBe(0.25)
    })

    it("accumulates multiple entries correctly", () => {
      recordCost(tmpDir, "01-scaffold", "builder", 0, makeClaudeResult(0.10))
      recordCost(tmpDir, "01-scaffold", "evaluator", 0, makeClaudeResult(0.05))
      const budget = recordCost(tmpDir, "02-api", "builder", 0, makeClaudeResult(0.20))

      expect(budget.entries).toHaveLength(3)
      expect(budget.totalCostUsd).toBeCloseTo(0.35)
    })

    it("records token counts from result", () => {
      const result = makeClaudeResult(0.10, 500, 250)
      const budget = recordCost(tmpDir, "phase", "builder", 0, result)

      expect(budget.entries[0].inputTokens).toBe(500)
      expect(budget.entries[0].outputTokens).toBe(250)
    })
  })

  describe("getTotalCost", () => {
    it("returns 0 when no budget exists", () => {
      expect(getTotalCost(tmpDir)).toBe(0)
    })

    it("returns total from existing budget", () => {
      recordCost(tmpDir, "phase", "builder", 0, makeClaudeResult(0.50))
      expect(getTotalCost(tmpDir)).toBe(0.50)
    })
  })
})
