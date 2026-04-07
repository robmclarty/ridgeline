import * as fs from "node:fs"
import * as path from "node:path"
import { BuildState, PhaseState, PhaseInfo, PipelineState, PipelineStage } from "../types"
import { checkpointTagName, verifyCompletionTag, cleanupBuildTags } from "./tags"

const statePath = (buildDir: string): string =>
  path.join(buildDir, "state.json")

const DEFAULT_PIPELINE: PipelineState = {
  shape: "pending",
  spec: "pending",
  plan: "pending",
  build: "pending",
}

export const loadState = (buildDir: string): BuildState | null => {
  const fp = statePath(buildDir)
  if (fs.existsSync(fp)) {
    const state: BuildState = JSON.parse(fs.readFileSync(fp, "utf-8"))
    // Backfill isMerged for legacy state files
    for (const phase of state.phases) {
      if ((phase as any).isMerged === undefined) {
        phase.isMerged = false
      }
    }
    // Backfill pipeline for legacy state files
    if (!state.pipeline) {
      state.pipeline = derivePipelineFromArtifacts(buildDir)
    }
    return state
  }
  return null
}

export const saveState = (buildDir: string, state: BuildState): void => {
  fs.writeFileSync(statePath(buildDir), JSON.stringify(state, null, 2) + "\n")
}

export const initState = (buildName: string, phases: PhaseInfo[]): BuildState => ({
  buildName,
  startedAt: new Date().toISOString(),
  pipeline: { ...DEFAULT_PIPELINE },
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

// ---------------------------------------------------------------------------
// Pipeline state helpers
// ---------------------------------------------------------------------------

/** Derive pipeline state from existing artifacts on disk (for legacy state files). */
const derivePipelineFromArtifacts = (buildDir: string): PipelineState => {
  const hasShape = fs.existsSync(path.join(buildDir, "shape.md"))
  const hasSpec = fs.existsSync(path.join(buildDir, "spec.md"))
  const hasConstraints = fs.existsSync(path.join(buildDir, "constraints.md"))
  const phasesDir = path.join(buildDir, "phases")
  const hasPhases = fs.existsSync(phasesDir) &&
    fs.readdirSync(phasesDir).some((f) => f.endsWith(".md") && /^\d+-.+\.md$/.test(f))

  return {
    shape: hasShape ? "complete" : "pending",
    spec: hasSpec && hasConstraints ? "complete" : "pending",
    plan: hasPhases ? "complete" : "pending",
    build: "pending",
  }
}

/** Get pipeline status, verifying against both state.json and file existence. */
export const getPipelineStatus = (buildDir: string): PipelineState => {
  const state = loadState(buildDir)
  const fromState = state?.pipeline ?? { ...DEFAULT_PIPELINE }
  const fromDisk = derivePipelineFromArtifacts(buildDir)

  // Belt and suspenders: if state says complete but file is missing, trust disk
  return {
    shape: fromState.shape === "complete" && fromDisk.shape === "complete" ? "complete" : fromDisk.shape,
    spec: fromState.spec === "complete" && fromDisk.spec === "complete" ? "complete" : fromDisk.spec,
    plan: fromState.plan === "complete" && fromDisk.plan === "complete" ? "complete" : fromDisk.plan,
    build: fromState.build === "pending" ? "pending" : fromState.build,
  }
}

/** Mark a pipeline stage as complete and persist. */
export const advancePipeline = (buildDir: string, buildName: string, stage: PipelineStage): void => {
  let state = loadState(buildDir)
  if (!state) {
    state = {
      buildName,
      startedAt: new Date().toISOString(),
      pipeline: { ...DEFAULT_PIPELINE },
      phases: [],
    }
  }
  if (stage === "build") {
    state.pipeline.build = "complete"
  } else {
    state.pipeline[stage] = "complete"
  }
  saveState(buildDir, state)
}

/** Set build pipeline stage to "running". */
export const markBuildRunning = (buildDir: string, buildName: string): void => {
  let state = loadState(buildDir)
  if (!state) {
    state = {
      buildName,
      startedAt: new Date().toISOString(),
      pipeline: { ...DEFAULT_PIPELINE },
      phases: [],
    }
  }
  state.pipeline.build = "running"
  saveState(buildDir, state)
}

const PIPELINE_STAGES: PipelineStage[] = ["shape", "spec", "plan", "build"]

/** Determine the next incomplete pipeline stage. */
export const getNextPipelineStage = (buildDir: string): PipelineStage | null => {
  const status = getPipelineStatus(buildDir)
  for (const stage of PIPELINE_STAGES) {
    const s = status[stage]
    if (s === "pending" || s === "running") return stage
  }
  return null
}

/**
 * Rewind to a given stage: mark downstream stages as pending,
 * return list of files/dirs to delete from disk.
 */
export const rewindTo = (buildDir: string, buildName: string, targetStage: PipelineStage): string[] => {
  const targetIndex = PIPELINE_STAGES.indexOf(targetStage)
  const toDelete: string[] = []

  // Determine which files to remove based on what stages are being reset
  const resetStages = PIPELINE_STAGES.slice(targetIndex + 1)

  for (const stage of resetStages) {
    switch (stage) {
      case "spec":
        for (const f of ["spec.md", "constraints.md", "taste.md"]) {
          const fp = path.join(buildDir, f)
          if (fs.existsSync(fp)) toDelete.push(fp)
        }
        break
      case "plan": {
        const phasesDir = path.join(buildDir, "phases")
        if (fs.existsSync(phasesDir)) {
          for (const f of fs.readdirSync(phasesDir)) {
            toDelete.push(path.join(phasesDir, f))
          }
        }
        break
      }
      case "build": {
        const handoff = path.join(buildDir, "handoff.md")
        if (fs.existsSync(handoff)) toDelete.push(handoff)
        // Feedback files live in phases/
        const pd = path.join(buildDir, "phases")
        if (fs.existsSync(pd)) {
          for (const f of fs.readdirSync(pd)) {
            if (f.includes("feedback")) toDelete.push(path.join(pd, f))
          }
        }
        break
      }
      // shape files are never downstream of anything
    }
  }

  // Update state.json
  let state = loadState(buildDir)
  if (state) {
    // Mark target stage as complete, downstream as pending
    for (const stage of PIPELINE_STAGES) {
      const idx = PIPELINE_STAGES.indexOf(stage)
      if (idx <= targetIndex) {
        if (stage === "build") {
          state.pipeline.build = idx < targetIndex ? state.pipeline.build : "pending"
        } else {
          // Keep existing status for stages at or before target
        }
      } else {
        state.pipeline[stage] = "pending" as any
      }
    }
    // Ensure target stage itself is complete
    if (targetStage === "build") {
      state.pipeline.build = "pending"
    } else {
      state.pipeline[targetStage] = "complete"
    }

    // Reset phases if rewinding past plan
    if (resetStages.includes("plan") || resetStages.includes("build")) {
      state.phases = []
    }

    // Clean up git tags if rewinding past build
    if (resetStages.includes("build")) {
      cleanupBuildTags(buildName)
    }

    saveState(buildDir, state)
  }

  return toDelete
}
