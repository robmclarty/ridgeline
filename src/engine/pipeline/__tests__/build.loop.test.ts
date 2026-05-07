import * as fs from "node:fs"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { makeTempDir } from "../../../../test/setup.js"
import { runBuilderLoop } from "../build.loop.js"
import type {
  BuilderInvoker,
  DiffHasher,
  BuilderLoopArgs,
} from "../build.loop.js"
import type { RidgelineConfig, PhaseInfo, ClaudeResult } from "../../../types.js"

vi.mock("../../discovery/agent.registry.js", () => ({
  buildAgentRegistry: () => ({
    getCorePrompt: () => "stub builder system prompt",
  }),
}))

vi.mock("../build.exec.js", () => ({
  assembleUserPrompt: () => "stub user prompt",
}))

const makeResult = (overrides: Partial<ClaudeResult> = {}): ClaudeResult => ({
  success: true,
  result: "READY_FOR_REVIEW",
  durationMs: 1234,
  costUsd: 0.5,
  usage: {
    inputTokens: 1000,
    outputTokens: 2000,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  },
  sessionId: "test-session",
  ...overrides,
})

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

const makePhase = (phasesDir: string, id = "01-test"): PhaseInfo => ({
  id,
  index: 1,
  slug: "test",
  filename: `${id}.md`,
  filepath: path.join(phasesDir, `${id}.md`),
  dependsOn: [],
})

const setupFixtureDir = (): { tmpDir: string; phasesDir: string } => {
  const tmpDir = makeTempDir()
  const phasesDir = path.join(tmpDir, "phases")
  fs.mkdirSync(phasesDir, { recursive: true })
  fs.writeFileSync(path.join(phasesDir, "01-test.md"), "# Test phase\n")
  return { tmpDir, phasesDir }
}

describe("runBuilderLoop", () => {
  let tmpDir: string
  let phasesDir: string

  beforeEach(() => {
    ({ tmpDir, phasesDir } = setupFixtureDir())
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const baseArgs = (overrides: Partial<BuilderLoopArgs> = {}): BuilderLoopArgs => ({
    config: makeConfig({ ridgelineDir: tmpDir, buildDir: tmpDir, phasesDir }),
    phase: makePhase(phasesDir),
    feedbackPath: null,
    cwd: tmpDir,
    diffHasher: () => "fixed-hash",
    ...overrides,
  })

  it("happy path: single invocation with READY_FOR_REVIEW exits the loop", async () => {
    const invoker: BuilderInvoker = vi.fn(async () => makeResult())
    const outcome = await runBuilderLoop(baseArgs({ invoker }))

    expect(invoker).toHaveBeenCalledTimes(1)
    expect(outcome.endReason).toBe("ready_for_review")
    expect(outcome.invocations).toHaveLength(1)
    expect(outcome.invocations[0].attempt).toBe(1)
    expect(outcome.cumulativeOutputTokens).toBe(2000)
    expect(outcome.cumulativeCostUsd).toBe(0.5)
  })

  it("loops once on MORE_WORK_NEEDED, then exits on READY_FOR_REVIEW", async () => {
    const invoker: BuilderInvoker = vi.fn()
      .mockResolvedValueOnce(makeResult({ result: "MORE_WORK_NEEDED: tests pending" }))
      .mockResolvedValueOnce(makeResult({ result: "READY_FOR_REVIEW" }))
    const diffHashes = ["hash-1", "hash-2"]
    const diffHasher: DiffHasher = vi.fn(() => diffHashes.shift() ?? null)

    const outcome = await runBuilderLoop(baseArgs({ invoker, diffHasher }))

    expect(invoker).toHaveBeenCalledTimes(2)
    expect(outcome.invocations.map((i) => i.endReason)).toEqual([
      "more_work_explicit",
      "ready_for_review",
    ])
    expect(outcome.invocations[1].attempt).toBe(2)
    expect(outcome.cumulativeOutputTokens).toBe(4000)
  })

  it("treats timeout as wind-down and continues to next attempt", async () => {
    const invoker: BuilderInvoker = vi.fn()
      .mockRejectedValueOnce(new Error("Claude invocation timed out"))
      .mockResolvedValueOnce(makeResult({ result: "READY_FOR_REVIEW" }))
    const diffHasher: DiffHasher = vi.fn().mockReturnValueOnce("h1").mockReturnValueOnce("h2")

    const outcome = await runBuilderLoop(baseArgs({ invoker, diffHasher }))

    expect(outcome.invocations[0].endReason).toBe("timeout")
    expect(outcome.invocations[1].endReason).toBe("ready_for_review")
    expect(outcome.endReason).toBe("ready_for_review")
  })

  it("treats missing marker as implicit more_work and continues", async () => {
    const invoker: BuilderInvoker = vi.fn()
      .mockResolvedValueOnce(makeResult({ result: "I did some work but forgot the marker" }))
      .mockResolvedValueOnce(makeResult({ result: "READY_FOR_REVIEW" }))
    const diffHasher: DiffHasher = vi.fn().mockReturnValueOnce("h1").mockReturnValueOnce("h2")

    const outcome = await runBuilderLoop(baseArgs({ invoker, diffHasher }))

    expect(outcome.invocations[0].endReason).toBe("more_work_implicit")
    expect(outcome.endReason).toBe("ready_for_review")
  })

  it("halts on no-progress (1 strike) when consecutive diffs match", async () => {
    const invoker: BuilderInvoker = vi.fn(async () =>
      makeResult({ result: "MORE_WORK_NEEDED: stuck" }),
    )
    const diffHasher: DiffHasher = vi.fn(() => "same-hash")

    const outcome = await runBuilderLoop(baseArgs({ invoker, diffHasher }))

    expect(outcome.endReason).toBe("halt_no_progress")
    expect(outcome.invocations).toHaveLength(2)
    expect(invoker).toHaveBeenCalledTimes(2)
  })

  it("halts at maxContinuations when builder never says READY_FOR_REVIEW", async () => {
    const invoker: BuilderInvoker = vi.fn(async () =>
      makeResult({ result: "MORE_WORK_NEEDED: still going" }),
    )
    let counter = 0
    const diffHasher: DiffHasher = vi.fn(() => `hash-${counter++}`)

    const outcome = await runBuilderLoop(
      baseArgs({ invoker, diffHasher, options: { maxContinuations: 3 } }),
    )

    expect(invoker).toHaveBeenCalledTimes(3)
    expect(outcome.endReason).toBe("halt_max_continuations")
  })

  it("halts on phase cost cap (5x phaseBudgetLimit) when phaseBudgetLimit is set", async () => {
    const invoker: BuilderInvoker = vi.fn(async () =>
      makeResult({ result: "MORE_WORK_NEEDED: keep going", costUsd: 50 }),
    )
    let counter = 0
    const diffHasher: DiffHasher = vi.fn(() => `hash-${counter++}`)

    const outcome = await runBuilderLoop(
      baseArgs({
        invoker,
        diffHasher,
        config: makeConfig({
          ridgelineDir: tmpDir,
          buildDir: tmpDir,
          phasesDir,
          phaseBudgetLimit: 10, // cap = 50
        }),
      }),
    )

    // First call: cumulative = 50, within cap.
    // Second call: cumulative = 100, exceeds 5×10 = 50 → halt.
    expect(outcome.endReason).toBe("halt_phase_cost_cap")
    expect(outcome.invocations).toHaveLength(2)
  })

  it("does not enforce phase cost cap when phaseBudgetLimit is null", async () => {
    const invoker: BuilderInvoker = vi.fn(async () =>
      makeResult({ result: "MORE_WORK_NEEDED: keep going", costUsd: 1000 }),
    )
    let counter = 0
    const diffHasher: DiffHasher = vi.fn(() => `hash-${counter++}`)

    const outcome = await runBuilderLoop(
      baseArgs({
        invoker,
        diffHasher,
        config: makeConfig({
          ridgelineDir: tmpDir,
          buildDir: tmpDir,
          phasesDir,
          phaseBudgetLimit: null,
        }),
        options: { maxContinuations: 2 },
      }),
    )

    // No phase cap; halts on max-continuations instead.
    expect(outcome.endReason).toBe("halt_max_continuations")
  })

  it("halts on global budget when callback returns true", async () => {
    const invoker: BuilderInvoker = vi.fn(async () =>
      makeResult({ result: "MORE_WORK_NEEDED: more", costUsd: 10 }),
    )
    let counter = 0
    const diffHasher: DiffHasher = vi.fn(() => `hash-${counter++}`)
    const globalBudgetCheck = (cumulative: number): boolean => cumulative > 15

    const outcome = await runBuilderLoop(
      baseArgs({
        invoker,
        diffHasher,
        globalBudgetCheck,
      }),
    )

    // Two calls, cumulative = 20, > 15 → halt.
    expect(outcome.endReason).toBe("halt_global_budget")
    expect(outcome.invocations).toHaveLength(2)
  })

  it("non-timeout errors bubble up unchanged", async () => {
    const invoker: BuilderInvoker = vi.fn(async () => {
      throw new Error("greywall denied something")
    })

    await expect(runBuilderLoop(baseArgs({ invoker }))).rejects.toThrow("greywall denied something")
  })

  it("passes the budget context to the invoker on each iteration", async () => {
    const calls: number[] = []
    const invoker: BuilderInvoker = vi.fn(async (_c, _p, _f, _cwd, ctx) => {
      calls.push(ctx.attempt)
      return makeResult({ result: ctx.attempt < 2 ? "MORE_WORK_NEEDED: more" : "READY_FOR_REVIEW" })
    })
    let counter = 0
    const diffHasher: DiffHasher = vi.fn(() => `hash-${counter++}`)

    await runBuilderLoop(baseArgs({ invoker, diffHasher }))

    expect(calls).toEqual([1, 2])
  })

  it("reads progress file content and passes it to continuation invocations", async () => {
    const phase = makePhase(phasesDir)
    const progressPath = path.join(phasesDir, `${phase.id}.builder-progress.md`)

    const invoker: BuilderInvoker = vi.fn(async (_c, _p, _f, _cwd, ctx) => {
      if (ctx.attempt === 1) {
        // Builder writes progress note before exiting MORE_WORK_NEEDED.
        fs.writeFileSync(progressPath, "## Continuation 1\n### Done\n- step A\n")
        return makeResult({ result: "MORE_WORK_NEEDED: still on step B" })
      }
      expect(ctx.progressFileContent).toContain("step A")
      return makeResult({ result: "READY_FOR_REVIEW" })
    })
    let counter = 0
    const diffHasher: DiffHasher = vi.fn(() => `h-${counter++}`)

    const outcome = await runBuilderLoop(baseArgs({ invoker, diffHasher, phase }))

    expect(outcome.endReason).toBe("ready_for_review")
    expect(invoker).toHaveBeenCalledTimes(2)
  })
})
