import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { isClaudeAvailable, setupE2eDir } from "./helpers"
import { runBuild } from "../../src/commands/build"
import type { RidgelineConfig } from "../../src/types"
import type { BuildState } from "../../src/types"
import type { BudgetState } from "../../src/types"

describe.skipIf(!isClaudeAvailable())("e2e: full pipeline", () => {
  let dir: string
  let config: RidgelineConfig
  let cleanup: () => void
  let originalCwd: string
  let originalExit: typeof process.exit

  beforeAll(() => {
    const setup = setupE2eDir()
    dir = setup.dir
    config = setup.config
    cleanup = setup.cleanup

    // Change cwd so the Claude subprocess works in the temp dir
    originalCwd = process.cwd()
    process.chdir(dir)

    // Mock process.exit to throw instead of killing the test runner
    originalExit = process.exit
    process.exit = vi.fn((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never
  })

  afterAll(() => {
    process.chdir(originalCwd)
    process.exit = originalExit
    cleanup()
  })

  it("plans, builds, and reviews the helloworld spec end-to-end", async () => {
    // runBuild auto-plans when no phases exist, then runs build+review
    await runBuild(config)

    // --- Phase files were generated ---
    const phaseFiles = fs.readdirSync(config.phasesDir).filter((f) => /^\d{2}-.*\.md$/.test(f))
    expect(phaseFiles.length).toBeGreaterThanOrEqual(1)

    // --- state.json: all phases complete ---
    const state: BuildState = JSON.parse(
      fs.readFileSync(path.join(config.buildDir, "state.json"), "utf-8")
    )
    expect(state.buildName).toBe("hello")
    expect(state.phases.length).toBeGreaterThanOrEqual(1)
    for (const phase of state.phases) {
      expect(phase.status).toBe("complete")
      expect(phase.completedAt).toBeTruthy()
      expect(phase.failedAt).toBeNull()
    }

    // --- budget.json: has entries and nonzero cost ---
    const budget: BudgetState = JSON.parse(
      fs.readFileSync(path.join(config.buildDir, "budget.json"), "utf-8")
    )
    expect(budget.totalCostUsd).toBeGreaterThan(0)
    expect(budget.entries.length).toBeGreaterThanOrEqual(3) // planner + at least 1 builder + 1 reviewer

    const roles = budget.entries.map((e) => e.role)
    expect(roles).toContain("planner")
    expect(roles).toContain("builder")
    expect(roles).toContain("reviewer")

    // --- trajectory.jsonl: correct event sequence ---
    const trajectory = fs
      .readFileSync(path.join(config.buildDir, "trajectory.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))

    const eventTypes = trajectory.map((e) => e.type)
    expect(eventTypes).toContain("plan_start")
    expect(eventTypes).toContain("plan_complete")
    expect(eventTypes).toContain("build_start")
    expect(eventTypes).toContain("build_complete")
    expect(eventTypes).toContain("review_start")
    expect(eventTypes).toContain("review_complete")
    expect(eventTypes).toContain("phase_advance")

    // plan_start should come before build_start
    expect(eventTypes.indexOf("plan_start")).toBeLessThan(eventTypes.indexOf("build_start"))

    // --- handoff.md: non-empty (builder wrote handoff notes) ---
    const handoff = fs.readFileSync(path.join(config.buildDir, "handoff.md"), "utf-8")
    expect(handoff.trim().length).toBeGreaterThan(0)

    // --- Built file exists and runs correctly ---
    const helloPath = path.join(dir, "hello.js")
    expect(fs.existsSync(helloPath)).toBe(true)

    const output = execSync("node hello.js", { cwd: dir, encoding: "utf-8" })
    expect(output).toContain("Hello")

    // --- No feedback files (everything passed) ---
    const feedbackFiles = fs.readdirSync(config.phasesDir).filter((f) => f.includes(".feedback"))
    expect(feedbackFiles.length).toBe(0)
  })
})
