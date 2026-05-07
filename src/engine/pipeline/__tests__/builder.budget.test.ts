import * as fs from "node:fs"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeTempDir } from "../../../../test/setup.js"
import {
  computeBuilderBudget,
  DEFAULT_HARD_LIMIT_FRACTION,
  DEFAULT_SOFT_LIMIT_FRACTION,
  SAFETY_MARGIN_TOKENS,
} from "../builder.budget.js"
import type { RidgelineConfig } from "../../../types.js"

const makeConfig = (overrides: Partial<RidgelineConfig>): RidgelineConfig =>
  ({
    buildName: "test",
    ridgelineDir: "/unused",
    buildDir: "/unused",
    constraintsPath: "/unused",
    tastePath: null,
    handoffPath: "/unused",
    phasesDir: "/unused",
    model: "claude-opus-4-7",
    maxRetries: 2,
    timeoutMinutes: 120,
    checkTimeoutSeconds: 1200,
    checkCommand: null,
    maxBudgetUsd: null,
    unsafe: false,
    sandboxMode: "semi-locked",
    sandboxExtras: { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
    networkAllowlist: [],
    extraContext: null,
    specialistCount: 3,
    specialistTimeoutSeconds: 600,
    phaseBudgetLimit: 15,
    phaseTokenLimit: 50_000,
    ...overrides,
  } as RidgelineConfig)

describe("computeBuilderBudget", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("uses the resolved context window minus input estimate minus safety margin as outputBudget", () => {
    const config = makeConfig({ ridgelineDir: tmpDir, model: "claude-opus-4-7", phaseTokenLimit: 50_000 })
    const sysPrompt = "x".repeat(4_000) // ≈ 1,000 tokens at 4 chars/token
    const userPrompt = "y".repeat(8_000) // ≈ 2,000 tokens
    const budget = computeBuilderBudget(sysPrompt, userPrompt, config)

    expect(budget.contextWindow).toBe(200_000)
    expect(budget.inputTokensEstimate).toBe(3_000)
    expect(budget.outputBudget).toBe(200_000 - 3_000 - SAFETY_MARGIN_TOKENS)
  })

  it("caps softLimit at phaseTokenLimit when context budget is larger", () => {
    const config = makeConfig({ ridgelineDir: tmpDir, model: "claude-opus-4-7", phaseTokenLimit: 50_000 })
    const budget = computeBuilderBudget("", "", config)
    // outputBudget is large; 70% of it is way above 50K, so cap kicks in.
    expect(budget.softLimit).toBe(50_000)
  })

  it("uses the context-derived value when phaseTokenLimit exceeds the context budget", () => {
    fs.writeFileSync(
      path.join(tmpDir, "settings.json"),
      JSON.stringify({ contextWindows: { "tiny-local-model": 10_000 } }),
    )
    const config = makeConfig({ ridgelineDir: tmpDir, model: "tiny-local-model", phaseTokenLimit: 50_000 })
    const budget = computeBuilderBudget("", "", config)
    expect(budget.outputBudget).toBe(10_000 - SAFETY_MARGIN_TOKENS)
    expect(budget.softLimit).toBeLessThan(50_000)
    expect(budget.softLimit).toBe(Math.floor(budget.outputBudget * DEFAULT_SOFT_LIMIT_FRACTION))
  })

  it("clamps outputBudget to 0 when input estimate exceeds the context window", () => {
    fs.writeFileSync(
      path.join(tmpDir, "settings.json"),
      JSON.stringify({ contextWindows: { "tiny-local-model": 1_000 } }),
    )
    const config = makeConfig({ ridgelineDir: tmpDir, model: "tiny-local-model", phaseTokenLimit: 50_000 })
    const sysPrompt = "x".repeat(40_000) // ≈ 10K tokens, well over the 1K window
    const budget = computeBuilderBudget(sysPrompt, "", config)
    expect(budget.outputBudget).toBe(0)
    expect(budget.softLimit).toBe(0)
    expect(budget.hardLimit).toBe(0)
  })

  it("hardLimit uses the default hardFraction by default", () => {
    const config = makeConfig({ ridgelineDir: tmpDir })
    const budget = computeBuilderBudget("", "", config)
    expect(budget.hardLimit).toBe(Math.floor(budget.outputBudget * DEFAULT_HARD_LIMIT_FRACTION))
  })

  it("respects custom soft/hard fractions", () => {
    const config = makeConfig({ ridgelineDir: tmpDir, phaseTokenLimit: 1_000_000 })
    const budget = computeBuilderBudget("", "", config, { softFraction: 0.5, hardFraction: 0.6 })
    expect(budget.softLimit).toBe(Math.floor(budget.outputBudget * 0.5))
    expect(budget.hardLimit).toBe(Math.floor(budget.outputBudget * 0.6))
  })

  it("falls back to defaults when fractions are out of range", () => {
    const config = makeConfig({ ridgelineDir: tmpDir, phaseTokenLimit: 1_000_000 })
    const budget = computeBuilderBudget("", "", config, { softFraction: 0, hardFraction: 1.5 })
    expect(budget.softLimit).toBe(Math.floor(budget.outputBudget * DEFAULT_SOFT_LIMIT_FRACTION))
    expect(budget.hardLimit).toBe(Math.floor(budget.outputBudget * DEFAULT_HARD_LIMIT_FRACTION))
  })

  it("treats phaseTokenLimit ≤ 0 as 'no soft cap' so context budget governs", () => {
    const config = makeConfig({ ridgelineDir: tmpDir, phaseTokenLimit: 0 })
    const budget = computeBuilderBudget("", "", config)
    expect(budget.softLimit).toBe(Math.floor(budget.outputBudget * DEFAULT_SOFT_LIMIT_FRACTION))
  })
})
