import * as fs from "node:fs"
import * as path from "node:path"
import { BuildState, PhaseState, PhaseInfo, PipelineState, PipelineStage } from "../types"
import { checkpointTagName, completionTagName, verifyCompletionTag, cleanupBuildTags } from "./tags"
import { readTrajectory } from "./trajectory"
import { atomicWriteSync } from "../utils/atomic-write"
import { withFileLock } from "../utils/file-lock"

const statePath = (buildDir: string): string =>
  path.join(buildDir, "state.json")

const DEFAULT_PIPELINE: PipelineState = {
  shape: "pending",
  design: "skipped",
  spec: "pending",
  research: "skipped",
  refine: "skipped",
  plan: "pending",
  build: "pending",
}

export const loadState = (
  buildDir: string,
  buildName?: string,
  phases?: PhaseInfo[],
): BuildState | null => {
  const fp = statePath(buildDir)
  if (fs.existsSync(fp)) {
    try {
      const state: BuildState = JSON.parse(fs.readFileSync(fp, "utf-8"))
      // Backfill pipeline for legacy state files
      if (!state.pipeline) {
        state.pipeline = derivePipelineFromArtifacts(buildDir)
      }
      return state
    } catch {
      // Corrupt JSON — fall through to trajectory recovery
    }
  }

  // Fallback: reconstruct from trajectory if caller provided enough context
  if (buildName && phases && phases.length > 0) {
    const recovered = rebuildStateFromTrajectory(buildDir, buildName, phases)
    if (recovered) {
      saveState(buildDir, recovered)
    }
    return recovered
  }

  return null
}

export const saveState = (buildDir: string, state: BuildState): void => {
  atomicWriteSync(statePath(buildDir), JSON.stringify(state, null, 2) + "\n")
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
    retries: 0,
    duration: null,
    completedAt: null,
    failedAt: null,
  })),
})

/**
 * Reconstruct BuildState from trajectory.jsonl when state.json is missing or corrupt.
 * Returns null if trajectory is empty (no recovery possible).
 */
export const rebuildStateFromTrajectory = (
  buildDir: string,
  buildName: string,
  phases: PhaseInfo[],
): BuildState | null => {
  const entries = readTrajectory(buildDir)
  if (entries.length === 0) return null

  const pipeline = derivePipelineFromArtifacts(buildDir)
  const startedAt = entries[0].timestamp

  const phaseStates: PhaseState[] = phases.map((p) => {
    const phaseEntries = entries.filter((e) => e.phaseId === p.id)
    const advanced = phaseEntries.find((e) => e.type === "phase_advance")
    const failed = phaseEntries.find((e) => e.type === "phase_fail")
    const buildStarts = phaseEntries.filter((e) => e.type === "build_start")
    const firstStart = buildStarts[0]
    const terminal = advanced ?? failed

    let duration: number | null = null
    if (firstStart && terminal) {
      duration = new Date(terminal.timestamp).getTime() - new Date(firstStart.timestamp).getTime()
    }

    return {
      id: p.id,
      status: advanced ? "complete" as const : failed ? "failed" as const : "pending" as const,
      checkpointTag: checkpointTagName(buildName, p.id),
      completionTag: advanced ? completionTagName(buildName, p.id) : null,
      retries: Math.max(0, buildStarts.length - 1),
      duration,
      completedAt: advanced?.timestamp ?? null,
      failedAt: failed?.timestamp ?? null,
    }
  })

  return { buildName, startedAt, pipeline, phases: phaseStates }
}

export const updatePhaseStatus = (
  buildDir: string,
  state: BuildState,
  phaseId: string,
  update: Partial<PhaseState>
): void => {
  const lockPath = statePath(buildDir) + ".lock"
  withFileLock(lockPath, () => {
    // Re-load from disk inside the lock — another parallel phase may have written
    const freshState = loadState(buildDir) ?? state
    const diskPhase = freshState.phases.find((p) => p.id === phaseId)
    if (diskPhase) {
      Object.assign(diskPhase, update)
      saveState(buildDir, freshState)
    }
    // Also update the in-memory state object for the caller
    const memPhase = state.phases.find((p) => p.id === phaseId)
    if (memPhase) Object.assign(memPhase, update)
  })
}

/**
 * Reconcile state.phases against the current phase files on disk.
 * Appends new phase files as pending entries, reorders to match disk order,
 * and drops entries whose phase file no longer exists. Idempotent.
 *
 * Handles cases like sub-phase splits (01 → 01a/01b) performed between runs:
 * without reconciliation, the new files aren't in state.phases and runPhase
 * throws "Phase <id> not found in state".
 */
export const reconcilePhases = (
  state: BuildState,
  phases: PhaseInfo[],
  buildName: string,
): { added: string[]; removed: string[] } => {
  const byId = new Map(state.phases.map((p) => [p.id, p]))
  const diskIds = new Set(phases.map((p) => p.id))

  const added: string[] = []
  const removed = state.phases.filter((p) => !diskIds.has(p.id)).map((p) => p.id)

  const reconciled: PhaseState[] = phases.map((p) => {
    const existing = byId.get(p.id)
    if (existing) return existing
    added.push(p.id)
    return {
      id: p.id,
      status: "pending",
      checkpointTag: checkpointTagName(buildName, p.id),
      completionTag: null,
      retries: 0,
      duration: null,
      completedAt: null,
      failedAt: null,
    }
  })

  state.phases = reconciled
  return { added, removed }
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
  const hasDesign = fs.existsSync(path.join(buildDir, "design.md"))
  const hasSpec = fs.existsSync(path.join(buildDir, "spec.md"))
  const hasConstraints = fs.existsSync(path.join(buildDir, "constraints.md"))
  const hasResearch = fs.existsSync(path.join(buildDir, "research.md"))
  const phasesDir = path.join(buildDir, "phases")
  const hasPhases = fs.existsSync(phasesDir) &&
    fs.readdirSync(phasesDir).some((f) => f.endsWith(".md") && /^\d+-.+\.md$/.test(f))

  return {
    shape: hasShape ? "complete" : "pending",
    design: hasDesign ? "complete" : "skipped",
    spec: hasSpec && hasConstraints ? "complete" : "pending",
    research: hasResearch ? "complete" : "skipped",
    refine: hasResearch ? "complete" : "skipped",
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
    design: fromState.design ?? "skipped",
    spec: fromState.spec === "complete" && fromDisk.spec === "complete" ? "complete" : fromDisk.spec,
    research: fromState.research ?? "skipped",
    refine: fromState.refine ?? "skipped",
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

// The ordered list of stages for auto-advance.
// Research and refine are excluded — they are opt-in only.
const REQUIRED_PIPELINE_STAGES: PipelineStage[] = ["shape", "spec", "plan", "build"]

// All stages including optional ones, for rewind calculations.
const ALL_PIPELINE_STAGES: PipelineStage[] = ["shape", "design", "spec", "research", "refine", "plan", "build"]

/** Determine the next incomplete pipeline stage. */
export const getNextPipelineStage = (buildDir: string): PipelineStage | null => {
  const status = getPipelineStatus(buildDir)
  for (const stage of REQUIRED_PIPELINE_STAGES) {
    const s = status[stage]
    if (s === "pending" || s === "running") return stage
  }
  return null
}

/** Collect files to delete when resetting a single stage. */
const collectStageFiles = (buildDir: string, stage: PipelineStage): string[] => {
  const files: string[] = []
  const phasesDir = path.join(buildDir, "phases")

  switch (stage) {
    case "research": {
      const fp = path.join(buildDir, "research.md")
      if (fs.existsSync(fp)) files.push(fp)
      break
    }
    case "design": {
      const fp = path.join(buildDir, "design.md")
      if (fs.existsSync(fp)) files.push(fp)
      break
    }
    case "refine":
      // Refine modifies spec.md in-place — no separate artifact to delete.
      // Rewinding to refine means "undo the refinement" which requires
      // rewinding spec too (the user should rewind to spec instead).
      break
    case "spec":
      for (const f of ["spec.md", "constraints.md", "taste.md"]) {
        const fp = path.join(buildDir, f)
        if (fs.existsSync(fp)) files.push(fp)
      }
      break
    case "plan":
      if (fs.existsSync(phasesDir)) {
        for (const f of fs.readdirSync(phasesDir)) files.push(path.join(phasesDir, f))
      }
      break
    case "build": {
      const handoff = path.join(buildDir, "handoff.md")
      if (fs.existsSync(handoff)) files.push(handoff)
      if (fs.existsSync(phasesDir)) {
        for (const f of fs.readdirSync(phasesDir)) {
          if (f.includes("feedback")) files.push(path.join(phasesDir, f))
        }
      }
      break
    }
  }

  return files
}

/** Type-safe setter for pipeline stage status, avoiding `as any` on indexed union types. */
const setPipelineStage = (
  pipeline: PipelineState,
  stage: PipelineStage,
  status: "pending" | "complete" | "skipped" | "running",
): void => {
  switch (stage) {
    case "shape": pipeline.shape = status as PipelineState["shape"]; break
    case "design": pipeline.design = status as PipelineState["design"]; break
    case "spec": pipeline.spec = status as PipelineState["spec"]; break
    case "research": pipeline.research = status as PipelineState["research"]; break
    case "refine": pipeline.refine = status as PipelineState["refine"]; break
    case "plan": pipeline.plan = status as PipelineState["plan"]; break
    case "build": pipeline.build = status as PipelineState["build"]; break
  }
}

/** Reset pipeline state for stages downstream of targetStage. */
const resetPipelineState = (
  buildDir: string,
  buildName: string,
  targetStage: PipelineStage,
  _resetStages: PipelineStage[],
): void => {
  const state = loadState(buildDir)
  if (!state) return

  const targetIndex = ALL_PIPELINE_STAGES.indexOf(targetStage)
  for (const stage of ALL_PIPELINE_STAGES) {
    if (ALL_PIPELINE_STAGES.indexOf(stage) > targetIndex) {
      // Optional stages reset to "skipped", required stages to "pending"
      if (stage === "research" || stage === "refine" || stage === "design") {
        setPipelineStage(state.pipeline, stage, "skipped")
      } else {
        setPipelineStage(state.pipeline, stage, "pending")
      }
    }
  }

  if (targetStage === "build") {
    setPipelineStage(state.pipeline, targetStage, "pending")
  } else {
    setPipelineStage(state.pipeline, targetStage, "complete")
  }

  if (_resetStages.includes("plan") || _resetStages.includes("build")) {
    state.phases = []
  }

  if (_resetStages.includes("build")) {
    cleanupBuildTags(buildName)
  }

  saveState(buildDir, state)
}

/**
 * Rewind to a given stage: mark downstream stages as pending,
 * return list of files/dirs to delete from disk.
 */
export const rewindTo = (buildDir: string, buildName: string, targetStage: PipelineStage): string[] => {
  const resetStages = ALL_PIPELINE_STAGES.slice(ALL_PIPELINE_STAGES.indexOf(targetStage) + 1)
  const toDelete = resetStages.flatMap((stage) => collectStageFiles(buildDir, stage))

  resetPipelineState(buildDir, buildName, targetStage, resetStages)

  return toDelete
}

/** Record matched shape names in build state. */
export const recordMatchedShapes = (buildDir: string, buildName: string, shapes: string[]): void => {
  let state = loadState(buildDir)
  if (!state) {
    state = {
      buildName,
      startedAt: new Date().toISOString(),
      pipeline: { ...DEFAULT_PIPELINE },
      phases: [],
    }
  }
  state.matchedShapes = shapes
  saveState(buildDir, state)
}

/** Read matched shapes from build state. Returns empty array if none recorded. */
export const getMatchedShapes = (buildDir: string): string[] => {
  const state = loadState(buildDir)
  return state?.matchedShapes ?? []
}
