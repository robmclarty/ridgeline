import { PhaseInfo } from "../../types.js"

/**
 * DAG-based phase scheduling. Phases declare dependencies via YAML frontmatter;
 * phases without dependencies implicitly depend on the immediately preceding phase
 * (backward-compatible sequential behavior).
 */

type PhaseGraph = {
  phases: PhaseInfo[]
  /** Map from phase ID to the set of phase IDs it depends on. */
  dependencies: Map<string, Set<string>>
}

/**
 * Build a dependency graph from phase metadata.
 * Phases without explicit `dependsOn` depend on the immediately preceding phase by index.
 */
export const buildPhaseGraph = (phases: PhaseInfo[]): PhaseGraph => {
  const sorted = [...phases].sort((a, b) => a.index - b.index)
  const dependencies = new Map<string, Set<string>>()

  for (let i = 0; i < sorted.length; i++) {
    const phase = sorted[i]

    if (phase.dependsOn.length > 0) {
      // Explicit dependencies declared in frontmatter
      dependencies.set(phase.id, new Set(phase.dependsOn))
    } else if (i > 0) {
      // Implicit: depends on the immediately preceding phase
      dependencies.set(phase.id, new Set([sorted[i - 1].id]))
    } else {
      // First phase: no dependencies
      dependencies.set(phase.id, new Set())
    }
  }

  return { phases: sorted, dependencies }
}

/**
 * Validate the graph: no cycles, no references to missing phases.
 * Throws on validation failure.
 */
export const validateGraph = (graph: PhaseGraph): void => {
  const ids = new Set(graph.phases.map((p) => p.id))

  // Check for missing dependencies
  for (const [phaseId, deps] of graph.dependencies) {
    for (const dep of deps) {
      if (!ids.has(dep)) {
        throw new Error(`Phase "${phaseId}" depends on unknown phase "${dep}"`)
      }
    }
  }

  // Check for cycles using DFS
  const visited = new Set<string>()
  const inStack = new Set<string>()

  const visit = (id: string): void => {
    if (inStack.has(id)) {
      throw new Error(`Dependency cycle detected involving phase "${id}"`)
    }
    if (visited.has(id)) return

    inStack.add(id)
    const deps = graph.dependencies.get(id) ?? new Set()
    for (const dep of deps) {
      visit(dep)
    }
    inStack.delete(id)
    visited.add(id)
  }

  for (const phase of graph.phases) {
    visit(phase.id)
  }
}

/**
 * Get phases whose dependencies are all satisfied (ready to execute).
 * Uses Kahn's algorithm logic: return phases with zero unsatisfied dependencies.
 */
export const getReadyPhases = (graph: PhaseGraph, completed: Set<string>): PhaseInfo[] => {
  const ready: PhaseInfo[] = []

  for (const phase of graph.phases) {
    if (completed.has(phase.id)) continue

    const deps = graph.dependencies.get(phase.id) ?? new Set()
    const isReady = [...deps].every((dep) => completed.has(dep))
    if (isReady) {
      ready.push(phase)
    }
  }

  return ready
}

/**
 * Check if the graph has any parallelism potential (any wave has more than one ready phase).
 */
export const hasParallelism = (graph: PhaseGraph): boolean => {
  const completed = new Set<string>()
  let foundParallel = false

  while (completed.size < graph.phases.length) {
    const ready = getReadyPhases(graph, completed)
    if (ready.length === 0) break
    if (ready.length > 1) {
      foundParallel = true
      break
    }
    completed.add(ready[0].id)
  }

  return foundParallel
}
