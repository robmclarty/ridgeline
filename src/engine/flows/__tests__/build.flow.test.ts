import { describe, it, expect } from "vitest"
import { run } from "fascicle"
import type { TrajectoryEvent, TrajectoryLogger } from "fascicle"
import type { PhaseInfo } from "../../../types.js"
import { buildFlow, type BuildFlowDeps, type BuildPhaseResult } from "../build.flow.js"
import type { WorktreeDriver, WorktreeItem } from "../../composites/index.js"

const makePhase = (id: string, index: number): PhaseInfo => ({
  id,
  index,
  slug: id,
  filename: `${id}.md`,
  filepath: `/tmp/phases/${id}.md`,
  dependsOn: [],
})

const recordingTrajectory = (): { logger: TrajectoryLogger; events: TrajectoryEvent[] } => {
  const events: TrajectoryEvent[] = []
  let counter = 0
  return {
    events,
    logger: {
      record: (event) => {
        events.push(event)
      },
      start_span: (name, meta) => {
        counter += 1
        const span_id = `span_${counter}`
        events.push({ kind: "span_start", span_id, name, ...(meta ?? {}) })
        return span_id
      },
      end_span: (span_id, meta) => {
        events.push({ kind: "span_end", span_id, ...(meta ?? {}) })
      },
    },
  }
}

const cannedDeps = (overrides: Partial<BuildFlowDeps> = {}): BuildFlowDeps => {
  const driver: WorktreeDriver<PhaseInfo, BuildPhaseResult> = {
    create: () => undefined,
    merge: () => undefined,
    remove: () => undefined,
  }
  return {
    runPhase: async () => "passed",
    worktreeDriver: driver,
    budgetSubscribe: () => () => undefined,
    maxBudgetUsd: Number.POSITIVE_INFINITY,
    shouldStop: () => false,
    ...overrides,
  }
}

const spanNames = (events: TrajectoryEvent[]): string[] => {
  const out: string[] = []
  for (const e of events) {
    if (e.kind === "span_start") {
      const name = (e as Record<string, unknown>).name
      if (typeof name === "string") out.push(name)
    }
  }
  return out
}

const minimalConfig = {
  buildName: "t",
  ridgelineDir: "/tmp/.ridgeline",
  buildDir: "/tmp/.ridgeline/builds/t",
  constraintsPath: "",
  tastePath: null,
  handoffPath: "",
  phasesDir: "",
  model: "opus",
  maxRetries: 0,
  timeoutMinutes: 1,
  checkTimeoutSeconds: 30,
  checkCommand: null,
  maxBudgetUsd: null,
  unsafe: false,
  sandboxMode: "off" as const,
  sandboxExtras: { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
  networkAllowlist: [],
  extraContext: null,
  specialistCount: 1 as const,
  specialistTimeoutSeconds: 60,
  phaseBudgetLimit: null,
  phaseTokenLimit: 16000,
  requirePhaseApproval: false,
}

describe("buildFlow", () => {
  it("exercises every Tier 1 composite (phase, graph_drain, worktree_isolated, diff_review, cost_capped)", async () => {
    const trajectory = recordingTrajectory()
    const flow = buildFlow(cannedDeps())
    const out = await run(
      flow,
      {
        config: { ...minimalConfig },
        waves: [[makePhase("a", 0), makePhase("b", 1)]],
        mainCwd: "/tmp",
      },
      { trajectory: trajectory.logger, install_signal_handlers: false },
    )
    const names = spanNames(trajectory.events)
    expect(names).toContain("build")
    expect(names).toContain("build.cost_capped")

    // Each Tier 1 composite emits a unique discriminator field via ctx.emit.
    // Inspecting these confirms the composite ran (not just constructed).
    const emits = trajectory.events.filter((e): e is Extract<TrajectoryEvent, { kind: "emit" }> => e.kind === "emit")
    const fieldsPresent = new Set<string>()
    for (const e of emits) {
      const rec = e as Record<string, unknown>
      for (const k of ["phase_event", "graph_drain_event", "worktree_event", "diff_review_event", "cost_capped_event"]) {
        if (rec[k] !== undefined) fieldsPresent.add(k)
      }
    }
    expect(fieldsPresent).toContain("phase_event")
    expect(fieldsPresent).toContain("graph_drain_event")
    expect(fieldsPresent).toContain("worktree_event")
    expect(fieldsPresent).toContain("diff_review_event")
    // cost_capped only emits cost_observed events when costs are observed; assert it's a span instead.
    expect(names).toContain("build.cost_capped")
    expect(out.completed).toBe(2)
    expect(out.failed).toBe(0)
  })

  it("delegates to the injected runPhase executor", async () => {
    const seen: string[] = []
    const flow = buildFlow(
      cannedDeps({
        runPhase: async (phase) => {
          seen.push(phase.id)
          return "passed"
        },
      }),
    )
    const out = await run(
      flow,
      {
        config: { ...minimalConfig },
        waves: [[makePhase("only", 0)]],
        mainCwd: "/tmp",
      },
      { install_signal_handlers: false },
    )
    expect(seen).toEqual(["only"])
    expect(out.completed).toBe(1)
  })

  it("counts failures and reports stoppedReason='failure'", async () => {
    const flow = buildFlow(
      cannedDeps({
        runPhase: async () => "failed",
      }),
    )
    const out = await run(
      flow,
      {
        config: { ...minimalConfig },
        waves: [[makePhase("p", 0)]],
        mainCwd: "/tmp",
      },
      { install_signal_handlers: false },
    )
    expect(out.failed).toBe(1)
    expect(out.stoppedReason).toBe("failure")
  })

  it("respects shouldStop() between waves and sets stoppedReason='user_stop'", async () => {
    let calls = 0
    const flow = buildFlow(
      cannedDeps({
        shouldStop: () => calls > 0,
        runPhase: async () => {
          calls += 1
          return "passed"
        },
      }),
    )
    const out = await run(
      flow,
      {
        config: { ...minimalConfig },
        waves: [[makePhase("a", 0)], [makePhase("b", 1)]],
        mainCwd: "/tmp",
      },
      { install_signal_handlers: false },
    )
    expect(out.completed).toBe(1)
    expect(out.stoppedReason).toBe("user_stop")
  })

  it("emits diff_review build → commit → diff → review event ordering", async () => {
    const trajectory = recordingTrajectory()
    const flow = buildFlow(cannedDeps())
    await run(
      flow,
      {
        config: { ...minimalConfig },
        waves: [[makePhase("solo", 0)]],
        mainCwd: "/tmp",
      },
      { trajectory: trajectory.logger, install_signal_handlers: false },
    )
    const diffEventOrder = trajectory.events
      .filter(
        (e): e is Extract<TrajectoryEvent, { kind: "emit" }> =>
          e.kind === "emit" && (e as Record<string, unknown>).diff_review_event !== undefined,
      )
      .map((e) => (e as Record<string, unknown>).diff_review_event as string)
    expect(diffEventOrder).toEqual([
      "build_start",
      "commit_start",
      "diff_start",
      "review_start",
      "review_complete",
    ])
  })
})
