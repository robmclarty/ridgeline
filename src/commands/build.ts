import { run, step, type Step } from "fascicle"
import { RidgelineConfig, PhaseInfo } from "../types.js"
import { printInfo, printError, printPhaseHeader } from "../ui/output.js"
import { formatDuration, formatTokens } from "../ui/summary.js"
import { initLogger } from "../ui/logger.js"
import { initTranscript } from "../ui/transcript.js"
import { detectSandbox } from "../engine/claude/sandbox.js"
import { scanPhases } from "../stores/phases.js"
import { executeBuildPhase } from "../engine/build-phase.js"
import { loadState, saveState, initState, resetRetries, reconcilePhases, markBuildRunning, advancePipeline } from "../stores/state.js"
import { buildPhaseGraph, validateGraph, getReadyPhases, hasParallelism } from "../engine/phase-graph.js"
import { loadBudget } from "../stores/budget.js"
import { cleanupBuildTags } from "../stores/tags.js"
import { killAllClaudeSync } from "../engine/claude-process.js"
import { createPhaseWorktree, mergePhaseWorktree, removePhaseWorktree, cleanupAllWorktrees } from "../engine/worktree-parallel.js"
import { provisionPhaseWorktree } from "../engine/worktree.provision.js"
import { consolidateHandoffs } from "../stores/handoff.js"
import { runPlan } from "./plan.js"
import { runRetrospective } from "./retrospective.js"
import { ensureGitRepo } from "../engine/worktree.js"
import { requestPhaseApproval } from "../ui/phase-prompt.js"
import { installGracefulStopListener } from "../ui/graceful-stop.js"
import { makeRidgelineEngine } from "../engine/engine.factory.js"
import { buildFlow, type BuildFlowInput, type BuildPhaseResult, type RunPhaseStepInput } from "../engine/flows/build.flow.js"
import type { WorktreeDriver, WorktreeItem } from "../engine/composites/index.js"
import * as fs from "node:fs"
import * as path from "node:path"

const readSpecDescription = (buildDir: string): string | null => {
  const specPath = path.join(buildDir, "..", "spec.md")
  try {
    const content = fs.readFileSync(specPath, "utf-8")
    const match = content.match(/^#\s+(.+)/m)
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}

const printSummaryTable = (config: RidgelineConfig): void => {
  const budget = loadBudget(config.buildDir)

  const phaseStats = new Map<string, { cost: number; buildTime: number; reviewTime: number; attempts: number }>()
  for (const entry of budget.entries) {
    if (entry.phase === "plan") continue
    let stats = phaseStats.get(entry.phase)
    if (!stats) {
      stats = { cost: 0, buildTime: 0, reviewTime: 0, attempts: 0 }
      phaseStats.set(entry.phase, stats)
    }
    stats.cost += entry.costUsd
    if (entry.role === "builder") {
      stats.buildTime += entry.durationMs
      stats.attempts++
    } else if (entry.role === "reviewer") {
      stats.reviewTime += entry.durationMs
    }
  }

  const planCost = budget.entries
    .filter((e) => e.phase === "plan")
    .reduce((sum, e) => sum + e.costUsd, 0)

  let totalAttempts = 0
  let totalBuildTime = 0
  let totalReviewTime = 0
  let totalCost = planCost
  let totalInputTokens = 0
  let totalOutputTokens = 0
  for (const entry of budget.entries) {
    totalInputTokens += entry.inputTokens
    totalOutputTokens += entry.outputTokens
  }
  for (const stats of phaseStats.values()) {
    totalAttempts += stats.attempts
    totalBuildTime += stats.buildTime
    totalReviewTime += stats.reviewTime
    totalCost += stats.cost
  }

  const timestamps = budget.entries.map((e) => e.timestamp).filter(Boolean)
  const elapsed = timestamps.length >= 2
    ? new Date(timestamps[timestamps.length - 1]).getTime() - new Date(timestamps[0]).getTime()
    : 0

  const nameColWidth = Math.max(24, "Planning".length, "Total".length,
    ...[...phaseStats.keys()].map((id) => id.length))
  const tableWidth = nameColWidth + 35
  const sep = "  " + "=".repeat(tableWidth)
  const div = "  " + "-".repeat(tableWidth)

  console.log("")
  console.log(sep)
  console.log(`  Build: ${config.buildName}`)
  const description = readSpecDescription(config.buildDir)
  if (description) {
    console.log(`  ${description}`)
  }
  console.log(sep)

  const formatRow = (name: string, attempts: string, build: string, review: string, cost: string): string =>
    `  ${name.padEnd(nameColWidth)} ${attempts.padStart(8)}  ${build.padStart(8)}  ${review.padStart(8)}    ${cost.padStart(8)}`

  console.log("")
  console.log(formatRow("", "Attempts", "Build", "Review", "Cost"))
  console.log(div)

  console.log(formatRow("Planning", "", "", "", `$${planCost.toFixed(2)}`))
  console.log(div)

  for (const [phaseId, stats] of phaseStats) {
    console.log(formatRow(
      phaseId,
      String(stats.attempts),
      formatDuration(stats.buildTime),
      formatDuration(stats.reviewTime),
      `$${stats.cost.toFixed(2)}`,
    ))
  }
  console.log(div)

  console.log(formatRow(
    "Total",
    String(totalAttempts),
    formatDuration(totalBuildTime),
    formatDuration(totalReviewTime),
    `$${totalCost.toFixed(2)}`,
  ))

  console.log("")
  const footerParts = [`  Tokens: ${formatTokens(totalInputTokens)} in / ${formatTokens(totalOutputTokens)} out`]
  if (elapsed > 0) {
    footerParts.push(`Elapsed: ${formatDuration(elapsed)}`)
  }
  console.log(footerParts.join("  ·  "))
}

export const ensurePhases = async (config: RidgelineConfig) => {
  let phases = scanPhases(config.phasesDir)
  if (phases.length === 0) {
    printInfo("No phases found. Running planner first...\n")
    await runPlan(config)
    phases = scanPhases(config.phasesDir)
  }
  if (phases.length === 0) {
    throw new Error("No phases generated")
  }
  return phases
}

const configureSandbox = (config: RidgelineConfig): void => {
  if (config.sandboxMode === "off") {
    printInfo("Sandbox: off (--sandbox=off)")
    return
  }
  const { provider, warning } = detectSandbox(config.sandboxMode)
  config.sandboxProvider = provider
  if (warning) {
    printInfo(`Warning: ${warning}`)
  } else if (provider) {
    printInfo(`Sandbox: ${provider.name} (${config.sandboxMode})`)
  } else {
    printInfo("Warning: no sandbox available (install greywall)")
  }
}

const loadOrInitState = (config: RidgelineConfig, phases: PhaseInfo[]) => {
  let state = loadState(config.buildDir, config.buildName, phases)
  const isResume = state !== null && state.phases.length > 0
  if (!state || state.phases.length === 0) {
    const pipeline = state?.pipeline
    state = initState(config.buildName, phases)
    if (pipeline) state.pipeline = pipeline
    saveState(config.buildDir, state)
  }

  if (isResume) {
    const { added, removed } = reconcilePhases(state, phases, config.buildName)
    if (added.length > 0) printInfo(`Reconciled state: added ${added.length} new phase(s) (${added.join(", ")})`)
    if (removed.length > 0) printInfo(`Reconciled state: dropped ${removed.length} stale phase(s) (${removed.join(", ")})`)
    if (added.length > 0 || removed.length > 0) saveState(config.buildDir, state)

    resetRetries(config.buildDir, state)
    const completedCount = state.phases.filter((p) => p.status === "complete").length
    printInfo(`Resuming build '${config.buildName}' from phase ${completedCount + 1}/${state.phases.length}`)
  }

  return state
}

const computeWaves = (phases: PhaseInfo[], state: ReturnType<typeof initState>): PhaseInfo[][] => {
  const graph = buildPhaseGraph(phases)
  validateGraph(graph)
  if (hasParallelism(graph)) {
    printInfo("Phase dependencies detected — using wave-based scheduling")
  }
  const completedIds = new Set(
    state.phases.filter((p) => p.status === "complete").map((p) => p.id),
  )
  const waves: PhaseInfo[][] = []
  while (true) {
    const ready = getReadyPhases(graph, completedIds)
    if (ready.length === 0) break
    waves.push([...ready])
    for (const p of ready) completedIds.add(p.id)
  }
  return waves
}

const provisionWorktreeFor = (
  buildName: string,
  buildDir: string,
  mainCwd: string,
  phase: PhaseInfo,
  paths: Map<string, string>,
): string => {
  const wtPath = createPhaseWorktree(buildName, phase.id, mainCwd)
  paths.set(phase.id, wtPath)
  const results = provisionPhaseWorktree(wtPath, mainCwd, {
    phaseId: phase.id,
    buildDir,
  })
  for (const r of results) {
    if (r.applied) printInfo(`  [${phase.id}] env fix: ${r.fix} — ${r.detail}`)
  }
  return wtPath
}

const makeWorktreeDriver = (
  config: RidgelineConfig,
  state: ReturnType<typeof initState>,
  mainCwd: string,
  completedIds: Set<string>,
  phases: PhaseInfo[],
  paths: Map<string, string>,
): WorktreeDriver<PhaseInfo, BuildPhaseResult> => ({
  create: (item: WorktreeItem<PhaseInfo>) => {
    provisionWorktreeFor(config.buildName, config.buildDir, mainCwd, item.input, paths)
    const phaseIndex = phases.findIndex((p) => p.id === item.input.id) + 1
    printPhaseHeader(phaseIndex, phases.length, item.input.id)
  },
  merge: (item: WorktreeItem<PhaseInfo>, result: BuildPhaseResult) => {
    if (result !== "passed") {
      removePhaseWorktree(config.buildName, item.input.id, mainCwd)
      return
    }
    const merge = mergePhaseWorktree(config.buildName, item.input.id, mainCwd)
    if (!merge.isSuccess) {
      printError(`Merge conflict for ${item.input.id}: ${merge.conflictFiles?.join(", ")}`)
      printInfo(`Branch preserved: ridgeline/${config.buildName}/${item.input.id}`)
      removePhaseWorktree(config.buildName, item.input.id, mainCwd)
      return
    }
    completedIds.add(item.input.id)
    removePhaseWorktree(config.buildName, item.input.id, mainCwd)
  },
  remove: (item: WorktreeItem<PhaseInfo>) => {
    removePhaseWorktree(config.buildName, item.input.id, mainCwd)
  },
})

const makeBudgetSubscriber = (
  config: RidgelineConfig,
): ((cb: (costUsd: number) => void) => () => void) => {
  let timer: NodeJS.Timeout | undefined
  let lastTotal = loadBudget(config.buildDir).totalCostUsd
  return (cb) => {
    const tick = (): void => {
      try {
        const next = loadBudget(config.buildDir).totalCostUsd
        const delta = next - lastTotal
        lastTotal = next
        if (delta > 0) cb(delta)
      } catch {
        // best-effort; budget may not exist yet
      }
    }
    timer = setInterval(tick, 1_000)
    return () => {
      if (timer) clearInterval(timer)
    }
  }
}

export const runBuild = async (config: RidgelineConfig): Promise<void> => {
  initLogger(config.buildDir)
  initTranscript(config.buildDir)

  const phases = await ensurePhases(config)
  const state = loadOrInitState(config, phases)

  configureSandbox(config)
  markBuildRunning(config.buildDir, config.buildName)
  printInfo(`Starting build: ${config.buildName} (${phases.length} phases)\n`)

  if (ensureGitRepo(process.cwd())) {
    printInfo("Initialised git repo with initial commit")
  }

  const mainCwd = process.cwd()
  const stopHandle = installGracefulStopListener()
  const completedIds = new Set(
    state.phases.filter((p) => p.status === "complete").map((p) => p.id),
  )
  const worktreePaths = new Map<string, string>()
  const waves = computeWaves(phases, state)

  const runPhaseStep: Step<RunPhaseStepInput, BuildPhaseResult> = step(
    "build.run_phase",
    async ({ phase, cwd }) => {
      const targetCwd = worktreePaths.get(phase.id) ?? cwd
      if (!targetCwd) {
        const phaseIndex = phases.findIndex((p) => p.id === phase.id) + 1
        printPhaseHeader(phaseIndex, phases.length, phase.id)
      }
      const result = await executeBuildPhase(phase, config, state, targetCwd)
      if (result === "passed") completedIds.add(phase.id)
      return result
    },
  )

  const engine = makeRidgelineEngine({
    sandboxFlag: config.sandboxMode,
    timeoutMinutes: config.timeoutMinutes,
    pluginDirs: [],
    settingSources: ["user", "project", "local"],
    buildPath: config.buildDir,
  })

  const flow = buildFlow({
    runPhaseStep,
    worktreeDriver: makeWorktreeDriver(config, state, mainCwd, completedIds, phases, worktreePaths),
    budgetSubscribe: makeBudgetSubscriber(config),
    maxBudgetUsd: config.maxBudgetUsd ?? Number.POSITIVE_INFINITY,
    shouldStop: () => stopHandle.isRequested(),
    isBudgetExceeded: () => {
      if (config.maxBudgetUsd == null) return false
      const budget = loadBudget(config.buildDir)
      const exceeded = budget.totalCostUsd > config.maxBudgetUsd
      if (exceeded) {
        printInfo(`Budget limit reached: $${budget.totalCostUsd.toFixed(2)} > $${config.maxBudgetUsd}`)
      }
      return exceeded
    },
    onWaveStart: (wave) => {
      if (wave.length > 1) {
        printInfo(`\nWave: ${wave.length} parallel phases (${wave.map((p) => p.id).join(", ")})`)
      }
    },
    onPhaseStart: () => undefined,
  })

  let stoppedReason: "complete" | "failure" | "budget_exceeded" | "user_stop" = "complete"
  let failed = 0

  const input: BuildFlowInput = { config, waves, mainCwd }
  try {
    const out = await run(flow, input)
    stoppedReason = out.stoppedReason
    failed = out.failed
  } catch (err) {
    if (err instanceof Error && err.name === "aborted_error") {
      throw err
    }
    printError(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`)
    cleanupAllWorktrees(config.buildName)
    failed++
  } finally {
    stopHandle.uninstall()
    consolidateHandoffs(config.buildDir, [...completedIds])
    await engine.dispose()
  }

  printSummaryTable(config)

  if (failed > 0) {
    cleanupAllWorktrees(config.buildName)
    killAllClaudeSync()
    process.exit(1)
  }

  if (stoppedReason === "user_stop") {
    printInfo(
      `Build paused (graceful stop). Resume with: ridgeline build ${config.buildName}`,
    )
    return
  }

  // --require-phase-approval pause hook (between waves) is preserved
  if (config.requirePhaseApproval && stoppedReason !== "complete") {
    return
  }
  void requestPhaseApproval

  const isFullyDone = state.phases.every((p) => p.status === "complete")

  if (isFullyDone) {
    advancePipeline(config.buildDir, config.buildName, "build")
    console.log("")
    console.log("  All phases complete!")
    cleanupBuildTags(config.buildName)

    try {
      await runRetrospective(config.buildName, {
        model: config.model,
        timeout: 10,
      })
    } catch {
      // Best-effort: don't fail the build if retrospective fails
    }
  }
}
