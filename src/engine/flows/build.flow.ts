import { aborted_error, branch, compose, map, pipe, sequence, step, type Step } from "fascicle"
import type { PhaseInfo, RidgelineConfig } from "../../types.js"
import {
  cost_capped,
  diff_review,
  graph_drain,
  phase,
  worktree_isolated,
  type WorktreeDriver,
  type WorktreeItem,
} from "../composites/index.js"

export type BuildPhaseResult = "passed" | "failed"

export type BuildFlowInput = {
  readonly config: RidgelineConfig
  readonly waves: ReadonlyArray<ReadonlyArray<PhaseInfo>>
  readonly mainCwd: string
}

export type BuildFlowOutput = {
  readonly completed: number
  readonly failed: number
  readonly stoppedReason: "complete" | "failure" | "budget_exceeded" | "user_stop"
}

export type RunPhaseExecutor = (
  phase: PhaseInfo,
  cwd: string | undefined,
) => Promise<BuildPhaseResult>

export type BuildFlowDeps = {
  readonly runPhase: RunPhaseExecutor
  readonly worktreeDriver: WorktreeDriver<PhaseInfo, BuildPhaseResult>
  readonly budgetSubscribe: (callback: (costUsd: number) => void) => () => void
  readonly maxBudgetUsd: number
  readonly shouldStop: () => boolean
  readonly isBudgetExceeded?: () => boolean
  readonly onWaveStart?: (wave: ReadonlyArray<PhaseInfo>) => void
  readonly onPhaseStart?: (phase: PhaseInfo) => void
}

const buildPhaseStep = (deps: BuildFlowDeps): Step<PhaseInfo, BuildPhaseResult> => {
  const passVerdict = step<BuildPhaseResult, { readonly passed: boolean; readonly verdict: BuildPhaseResult }>(
    "build.verdict",
    (verdict) => ({ passed: verdict === "passed", verdict }),
  )
  const buildLeaf = step<PhaseInfo, PhaseInfo>("build.leaf", async (p, ctx) => {
    deps.onPhaseStart?.(p)
    ctx.emit({ build_event: "phase_start", phase_id: p.id })
    return p
  })
  const reviewLeaf = step<PhaseInfo, BuildPhaseResult>("build.review_leaf", async (p, ctx) => {
    const result = await deps.runPhase(p, undefined)
    ctx.emit({ build_event: "phase_end", phase_id: p.id, result })
    return result
  })
  const reviewedBuild = diff_review<PhaseInfo, BuildPhaseResult, BuildPhaseResult>({
    name: "build.diff_review",
    build: step<PhaseInfo, BuildPhaseResult>(
      "build.diff_review_build",
      async (p, ctx) => {
        const stage1 = await buildLeaf.run(p, ctx)
        return reviewLeaf.run(stage1, ctx)
      },
    ),
    commit: step<BuildPhaseResult, BuildPhaseResult>("build.diff_review_commit", (v) => v),
    diff: step<BuildPhaseResult, BuildPhaseResult>("build.diff_review_diff", (v) => v),
    review: step<BuildPhaseResult, BuildPhaseResult>("build.diff_review_review", (v) => v),
  })
  const phased = phase<PhaseInfo, BuildPhaseResult, BuildPhaseResult>({
    name: "build.phase",
    build: reviewedBuild,
    review: passVerdict,
    max_retries: 0,
  })
  return pipe(phased, (r) => r.verdict, { name: "build.phase_runner" })
}

const sequentialWaveStep = (
  deps: BuildFlowDeps,
): Step<ReadonlyArray<PhaseInfo>, ReadonlyArray<BuildPhaseResult>> =>
  map<ReadonlyArray<PhaseInfo>, PhaseInfo, BuildPhaseResult>({
    name: "build.sequential_wave",
    items: (phases) => phases,
    do: buildPhaseStep(deps),
    concurrency: 1,
  })

const isolatedWavePath = (
  deps: BuildFlowDeps,
): Step<ReadonlyArray<PhaseInfo>, ReadonlyArray<BuildPhaseResult>> => {
  const phaseFromItem = pipe(
    step<WorktreeItem<PhaseInfo>, PhaseInfo>("build.unwrap_worktree_item", (item) => item.input),
    (p) => p,
    { name: "build.unwrap_worktree_pipe" },
  )
  // Per-item sequence: unwrap → run phase composite. The phase composite must be
  // dispatched (not .run()'d) so its span is emitted; sequence does that.
  const perItem = sequence([
    step<WorktreeItem<PhaseInfo>, PhaseInfo>("build.unwrap_worktree_item", (item) => item.input),
    buildPhaseStep(deps),
  ])
  void phaseFromItem
  const isolated = worktree_isolated<PhaseInfo, BuildPhaseResult>({
    name: "build.worktree_isolated",
    driver: deps.worktreeDriver,
    do: perItem,
  })
  return pipe(
    sequence([
      step<ReadonlyArray<PhaseInfo>, ReadonlyArray<WorktreeItem<PhaseInfo>>>(
        "build.wrap_worktree_items",
        (waveInput, ctx) => {
          deps.onWaveStart?.(waveInput)
          ctx.emit({ build_event: "wave_start", size: waveInput.length, isolated: true })
          return waveInput.map((p, i) => ({ index: i, input: p }))
        },
      ),
      isolated,
    ]),
    (results) => results,
    { name: "build.isolated_wave_pipe" },
  )
}

const sequentialWavePath = (
  deps: BuildFlowDeps,
): Step<ReadonlyArray<PhaseInfo>, ReadonlyArray<BuildPhaseResult>> =>
  pipe(
    sequence([
      step<ReadonlyArray<PhaseInfo>, ReadonlyArray<PhaseInfo>>(
        "build.announce_sequential_wave",
        (waveInput, ctx) => {
          deps.onWaveStart?.(waveInput)
          ctx.emit({ build_event: "wave_start", size: waveInput.length, isolated: false })
          return waveInput
        },
      ),
      sequentialWaveStep(deps),
    ]),
    (results) => results,
    { name: "build.sequential_wave_pipe" },
  )

const waveBranch = (
  deps: BuildFlowDeps,
): Step<ReadonlyArray<PhaseInfo>, ReadonlyArray<BuildPhaseResult>> =>
  branch<ReadonlyArray<PhaseInfo>, ReadonlyArray<BuildPhaseResult>>({
    name: "build.wave_branch",
    when: (wave) => wave.length > 1,
    then: isolatedWavePath(deps),
    otherwise: sequentialWavePath(deps),
  })

type StoppedRef = { reason: BuildFlowOutput["stoppedReason"] }

const guardedWaveStep = (
  deps: BuildFlowDeps,
  stopped: StoppedRef,
): Step<ReadonlyArray<PhaseInfo>, ReadonlyArray<BuildPhaseResult>> => {
  const inner = waveBranch(deps)
  return step<ReadonlyArray<PhaseInfo>, ReadonlyArray<BuildPhaseResult>>(
    "build.wave_guarded",
    async (wave, ctx) => {
      if (stopped.reason !== "complete") return []
      if (deps.shouldStop()) {
        stopped.reason = "user_stop"
        return []
      }
      let results: ReadonlyArray<BuildPhaseResult>
      try {
        results = await inner.run(wave, ctx)
      } catch (err) {
        // Phase composite throws "Retries exhausted" on max_retries+1 failures.
        // The build flow uses max_retries=0 so a single failed phase triggers it;
        // surface that as a single failure result rather than tearing down the run.
        if (err instanceof Error && err.message === "Retries exhausted") {
          stopped.reason = "failure"
          return wave.map(() => "failed" as BuildPhaseResult)
        }
        throw err
      }
      // Budget is checked AFTER each wave (matches legacy behavior).
      if (deps.isBudgetExceeded?.()) {
        stopped.reason = "budget_exceeded"
      }
      return results
    },
  )
}

const drainWavesStep = (
  deps: BuildFlowDeps,
  stopped: StoppedRef,
): Step<ReadonlyArray<ReadonlyArray<PhaseInfo>>, ReadonlyArray<ReadonlyArray<BuildPhaseResult>>> =>
  graph_drain<ReadonlyArray<PhaseInfo>, ReadonlyArray<BuildPhaseResult>>({
    name: "build.graph_drain",
    do: guardedWaveStep(deps, stopped),
    concurrency: 1,
  })

const aggregateOutputs = (
  results: ReadonlyArray<ReadonlyArray<BuildPhaseResult>>,
  stopped: StoppedRef,
): BuildFlowOutput => {
  let completed = 0
  let failed = 0
  for (const wave of results) {
    for (const r of wave) {
      if (r === "passed") completed += 1
      else failed += 1
    }
  }
  let stoppedReason: BuildFlowOutput["stoppedReason"] = stopped.reason
  if (stoppedReason === "complete" && failed > 0) stoppedReason = "failure"
  return { completed, failed, stoppedReason }
}

export const buildFlow = (deps: BuildFlowDeps): Step<BuildFlowInput, BuildFlowOutput> => {
  const stopped: StoppedRef = { reason: "complete" }
  const drain = drainWavesStep(deps, stopped)
  const cappedDrain = cost_capped<
    ReadonlyArray<ReadonlyArray<PhaseInfo>>,
    ReadonlyArray<ReadonlyArray<BuildPhaseResult>>
  >({
    name: "build.cost_capped",
    do: drain,
    max_usd: deps.maxBudgetUsd,
    subscribe: deps.budgetSubscribe,
  })
  const flow = pipe(
    sequence([
      step<BuildFlowInput, ReadonlyArray<ReadonlyArray<PhaseInfo>>>(
        "build.extract_waves",
        (input) => input.waves,
      ),
      cappedDrain,
    ]),
    (results) => aggregateOutputs(results, stopped),
    { name: "build.aggregate" },
  )
  return compose("build", flow)
}
