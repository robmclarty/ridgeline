import * as fs from "node:fs"
import * as path from "node:path"
import { BuildState, PhaseState, PhaseInfo } from "../types"
import { checkpointTagName, verifyCompletionTag } from "./tags"

const statePath = (buildDir: string): string =>
  path.join(buildDir, "state.json")

export const loadState = (buildDir: string): BuildState | null => {
  const fp = statePath(buildDir)
  if (fs.existsSync(fp)) {
    return JSON.parse(fs.readFileSync(fp, "utf-8"))
  }
  return null
}

export const saveState = (buildDir: string, state: BuildState): void => {
  fs.writeFileSync(statePath(buildDir), JSON.stringify(state, null, 2) + "\n")
}

export const initState = (buildName: string, phases: PhaseInfo[]): BuildState => ({
  buildName,
  startedAt: new Date().toISOString(),
  phases: phases.map((p) => ({
    id: p.id,
    status: "pending",
    checkpointTag: checkpointTagName(buildName, p.id),
    completionTag: null,
    isMerged: false,
    retries: 0,
    duration: null,
    completedAt: null,
    failedAt: null,
  })),
})

export const updatePhaseStatus = (
  buildDir: string,
  state: BuildState,
  phaseId: string,
  update: Partial<PhaseState>
): void => {
  const phase = state.phases.find((p) => p.id === phaseId)
  if (phase) {
    Object.assign(phase, update)
    saveState(buildDir, state)
  }
}

export const resetRetries = (buildDir: string, state: BuildState): void => {
  for (const phase of state.phases) {
    if (phase.status !== "complete") {
      phase.retries = 0
      phase.status = "pending"
      phase.failedAt = null
    }
  }
  saveState(buildDir, state)
}

export const getNextUnmergedPhase = (state: BuildState): PhaseState | null => {
  for (const phase of state.phases) {
    if (phase.status === "complete" && !phase.isMerged) {
      return phase
    }
  }
  return null
}

export const getNextIncompletePhase = (
  state: BuildState,
  cwd?: string
): PhaseState | null => {
  for (const phase of state.phases) {
    if (phase.status === "complete") {
      // Verify the completion tag still exists
      if (!verifyCompletionTag(state.buildName, phase.id, cwd)) {
        // Tag was deleted — treat as incomplete
        phase.status = "pending"
        phase.completionTag = null
        return phase
      }
      continue
    }
    return phase
  }
  return null
}
