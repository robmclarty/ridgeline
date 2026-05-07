import type { BuildState, BudgetState, PhaseState, TrajectoryEntry } from "../../types.js"

export type DashboardStatus = "pending" | "running" | "done" | "failed" | "idle"

export interface DashboardPhase {
  id: string
  slug: string
  status: PhaseState["status"] | "skipped"
  retries: number
  duration: number | null
  completedAt: string | null
  failedAt: string | null
}

export interface DashboardSnapshot {
  buildName: string | null
  startedAt: string | null
  status: DashboardStatus
  phases: DashboardPhase[]
  budget: {
    totalCostUsd: number
    perRole: { role: string; costUsd: number }[]
  }
  lastError: { phaseId: string | null; message: string } | null
}

const roleOrder = ["planner", "specialist", "synthesizer", "researcher", "refiner", "builder", "reviewer"]

const deriveStatus = (state: BuildState | null): DashboardStatus => {
  if (!state) return "idle"
  const pipeline = state.pipeline
  if (state.phases.some((p) => p.status === "failed")) return "failed"
  const allComplete = state.phases.length > 0 && state.phases.every((p) => p.status === "complete")
  if (pipeline.build === "complete" && allComplete) return "done"
  if (pipeline.build === "running") return "running"
  if (state.phases.some((p) => p.status === "building" || p.status === "reviewing")) return "running"
  return "pending"
}

const slugOf = (id: string): string => {
  const match = id.match(/^\d+[a-z]?-(.*)$/)
  return match ? match[1] : id
}

const summarizeBudget = (budget: BudgetState): DashboardSnapshot["budget"] => {
  const byRole = new Map<string, number>()
  for (const entry of budget.entries) {
    byRole.set(entry.role, (byRole.get(entry.role) ?? 0) + entry.costUsd)
  }
  const perRole: { role: string; costUsd: number }[] = []
  for (const role of roleOrder) {
    if (byRole.has(role)) perRole.push({ role, costUsd: byRole.get(role) ?? 0 })
  }
  for (const [role, cost] of byRole) {
    if (!roleOrder.includes(role)) perRole.push({ role, costUsd: cost })
  }
  return { totalCostUsd: budget.totalCostUsd, perRole }
}

const findLastError = (trajectory: TrajectoryEntry[]): DashboardSnapshot["lastError"] => {
  for (let i = trajectory.length - 1; i >= 0; i--) {
    const entry = trajectory[i]
    if (entry.type === "phase_fail" || entry.type === "budget_exceeded") {
      return { phaseId: entry.phaseId, message: entry.summary }
    }
  }
  return null
}

export const buildSnapshot = (
  buildName: string | null,
  state: BuildState | null,
  budget: BudgetState,
  trajectory: TrajectoryEntry[],
): DashboardSnapshot => {
  const phases: DashboardPhase[] = state
    ? state.phases.map((p) => ({
        id: p.id,
        slug: slugOf(p.id),
        status: p.status,
        retries: p.retries,
        duration: p.duration,
        completedAt: p.completedAt,
        failedAt: p.failedAt,
      }))
    : []
  return {
    buildName,
    startedAt: state?.startedAt ?? null,
    status: deriveStatus(state),
    phases,
    budget: summarizeBudget(budget),
    lastError: findLastError(trajectory),
  }
}
