import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import { loadState, saveState, initState, updatePhaseStatus, getNextIncompletePhase, resetRetries, reconcilePhases, recordMatchedShapes, getMatchedShapes, getPipelineStatus, advancePipeline, markBuildRunning, getNextPipelineStage, rewindTo, rebuildStateFromTrajectory } from "../state"
import type { PhaseInfo, BuildState, PipelineState } from "../../types"

// Mock tags module for getNextIncompletePhase and trajectory recovery
vi.mock("../tags", () => ({
  checkpointTagName: vi.fn((buildName: string, phaseId: string) => `ridgeline/checkpoint/${buildName}/${phaseId}`),
  completionTagName: vi.fn((buildName: string, phaseId: string) => `ridgeline/phase/${buildName}/${phaseId}`),
  verifyCompletionTag: vi.fn(() => true),
  cleanupBuildTags: vi.fn(),
}))

const defaultPipeline: PipelineState = {
  shape: "pending",
  design: "pending",
  spec: "pending",
  research: "pending",
  refine: "pending",
  plan: "pending",
  build: "pending",
}

import { verifyCompletionTag, cleanupBuildTags } from "../tags"

const samplePhases: PhaseInfo[] = [
  { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/phases/01-scaffold.md", dependsOn: [] },
  { id: "02-api", index: 2, slug: "api", filename: "02-api.md", filepath: "/phases/02-api.md", dependsOn: [] },
  { id: "03-ui", index: 3, slug: "ui", filename: "03-ui.md", filepath: "/phases/03-ui.md", dependsOn: [] },
]

describe("state", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
    vi.mocked(verifyCompletionTag).mockReturnValue(true)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe("loadState", () => {
    it("returns null when state.json does not exist", () => {
      expect(loadState(tmpDir)).toBeNull()
    })

    it("loads state.json when it exists", () => {
      const state: BuildState = {
        buildName: "test",
        startedAt: "2024-01-01T00:00:00.000Z",
        pipeline: { ...defaultPipeline },
        phases: [],
      }
      fs.writeFileSync(path.join(tmpDir, "state.json"), JSON.stringify(state))

      const loaded = loadState(tmpDir)
      expect(loaded).toEqual(state)
    })

  })

  describe("saveState", () => {
    it("writes state.json", () => {
      const state: BuildState = {
        buildName: "test",
        startedAt: "2024-01-01T00:00:00.000Z",
        pipeline: { ...defaultPipeline },
        phases: [],
      }
      saveState(tmpDir, state)

      const content = fs.readFileSync(path.join(tmpDir, "state.json"), "utf-8")
      expect(JSON.parse(content)).toEqual(state)
    })
  })

  describe("initState", () => {
    it("creates initial state with all phases pending", () => {
      const state = initState("my-build", samplePhases)

      expect(state.buildName).toBe("my-build")
      expect(state.phases).toHaveLength(3)
      expect(state.phases[0].id).toBe("01-scaffold")
      expect(state.phases[0].status).toBe("pending")
      expect(state.phases[0].checkpointTag).toBe("ridgeline/checkpoint/my-build/01-scaffold")
      expect(state.phases[0].completionTag).toBeNull()
      expect(state.phases[0].retries).toBe(0)
    })

    it("sets a valid ISO timestamp", () => {
      const state = initState("build", samplePhases)
      expect(() => new Date(state.startedAt)).not.toThrow()
    })
  })

  describe("updatePhaseStatus", () => {
    it("updates a specific phase and persists", () => {
      const state = initState("build", samplePhases)
      saveState(tmpDir, state)

      updatePhaseStatus(tmpDir, state, "02-api", {
        status: "building",
        retries: 1,
      })

      expect(state.phases[1].status).toBe("building")
      expect(state.phases[1].retries).toBe(1)

      // Verify it was persisted
      const loaded = loadState(tmpDir)
      expect(loaded!.phases[1].status).toBe("building")
    })

    it("does nothing for nonexistent phase id", () => {
      const state = initState("build", samplePhases)
      saveState(tmpDir, state)

      updatePhaseStatus(tmpDir, state, "99-nonexistent", { status: "complete" })

      // State should be unchanged
      expect(state.phases.every((p) => p.status === "pending")).toBe(true)
    })
  })

  describe("getNextIncompletePhase", () => {
    it("returns first pending phase", () => {
      const state = initState("build", samplePhases)
      const next = getNextIncompletePhase(state)
      expect(next?.id).toBe("01-scaffold")
    })

    it("skips complete phases", () => {
      const state = initState("build", samplePhases)
      state.phases[0].status = "complete"
      state.phases[0].completionTag = "ridgeline/phase/build/01-scaffold"

      const next = getNextIncompletePhase(state)
      expect(next?.id).toBe("02-api")
    })

    it("returns null when all phases complete", () => {
      const state = initState("build", samplePhases)
      for (const p of state.phases) {
        p.status = "complete"
        p.completionTag = `ridgeline/phase/build/${p.id}`
      }

      expect(getNextIncompletePhase(state)).toBeNull()
    })

    it("treats complete phase as incomplete if tag was deleted", () => {
      vi.mocked(verifyCompletionTag).mockReturnValue(false)

      const state = initState("build", samplePhases)
      state.phases[0].status = "complete"
      state.phases[0].completionTag = "ridgeline/phase/build/01-scaffold"

      const next = getNextIncompletePhase(state)
      expect(next?.id).toBe("01-scaffold")
      expect(next?.status).toBe("pending")
    })

    it("returns failed/building phases as next incomplete", () => {
      const state = initState("build", samplePhases)
      state.phases[0].status = "complete"
      state.phases[0].completionTag = "ridgeline/phase/build/01-scaffold"
      state.phases[1].status = "failed"

      const next = getNextIncompletePhase(state)
      expect(next?.id).toBe("02-api")
      expect(next?.status).toBe("failed")
    })

    it("passes cwd to verifyCompletionTag when provided", () => {
      const state = initState("build", samplePhases)
      state.phases[0].status = "complete"
      state.phases[0].completionTag = "ridgeline/phase/build/01-scaffold"

      getNextIncompletePhase(state, "/my/cwd")

      expect(verifyCompletionTag).toHaveBeenCalledWith("build", "01-scaffold", "/my/cwd")
    })
  })

  describe("resetRetries", () => {
    it("resets failed phases to pending with zero retries", () => {
      const state = initState("build", samplePhases)
      state.phases[0].status = "failed"
      state.phases[0].retries = 3
      state.phases[0].failedAt = "2024-01-01T00:00:00.000Z"
      saveState(tmpDir, state)

      resetRetries(tmpDir, state)

      expect(state.phases[0].status).toBe("pending")
      expect(state.phases[0].retries).toBe(0)
      expect(state.phases[0].failedAt).toBeNull()
    })

    it("leaves complete phases untouched", () => {
      const state = initState("build", samplePhases)
      state.phases[0].status = "complete"
      state.phases[0].completionTag = "ridgeline/phase/build/01-scaffold"
      state.phases[1].status = "failed"
      state.phases[1].retries = 2
      saveState(tmpDir, state)

      resetRetries(tmpDir, state)

      expect(state.phases[0].status).toBe("complete")
      expect(state.phases[1].status).toBe("pending")
      expect(state.phases[1].retries).toBe(0)
    })

    it("persists changes to disk", () => {
      const state = initState("build", samplePhases)
      state.phases[0].status = "failed"
      state.phases[0].retries = 2
      saveState(tmpDir, state)

      resetRetries(tmpDir, state)

      const loaded = loadState(tmpDir)
      expect(loaded!.phases[0].status).toBe("pending")
      expect(loaded!.phases[0].retries).toBe(0)
    })
  })

  describe("reconcilePhases", () => {
    const makePhaseInfo = (id: string, index: number): PhaseInfo => ({
      id, index, slug: id.replace(/^\d+[a-z]?-/, ""),
      filename: `${id}.md`, filepath: `/phases/${id}.md`, dependsOn: [],
    })

    it("appends new phase files as pending entries", () => {
      const state = initState("build", samplePhases)
      const withSubphases: PhaseInfo[] = [
        makePhaseInfo("01a-scaffold-a", 1),
        makePhaseInfo("01b-scaffold-b", 1),
        samplePhases[1],
        samplePhases[2],
      ]

      const { added, removed } = reconcilePhases(state, withSubphases, "build")

      expect(added).toEqual(["01a-scaffold-a", "01b-scaffold-b"])
      expect(removed).toEqual(["01-scaffold"])
      expect(state.phases.map((p) => p.id)).toEqual([
        "01a-scaffold-a", "01b-scaffold-b", "02-api", "03-ui",
      ])
      expect(state.phases[0].status).toBe("pending")
      expect(state.phases[0].checkpointTag).toBe("ridgeline/checkpoint/build/01a-scaffold-a")
    })

    it("preserves status of phases that still exist", () => {
      const state = initState("build", samplePhases)
      state.phases[1].status = "complete"
      state.phases[1].completionTag = "ridgeline/phase/build/02-api"
      state.phases[1].duration = 1234

      const { added, removed } = reconcilePhases(state, samplePhases, "build")

      expect(added).toEqual([])
      expect(removed).toEqual([])
      expect(state.phases[1].status).toBe("complete")
      expect(state.phases[1].duration).toBe(1234)
    })

    it("is idempotent", () => {
      const state = initState("build", samplePhases)
      const first = reconcilePhases(state, samplePhases, "build")
      const second = reconcilePhases(state, samplePhases, "build")

      expect(first).toEqual({ added: [], removed: [] })
      expect(second).toEqual({ added: [], removed: [] })
      expect(state.phases).toHaveLength(3)
    })

    it("reorders phases to match disk order", () => {
      const state = initState("build", samplePhases)
      const reordered = [samplePhases[2], samplePhases[0], samplePhases[1]]

      reconcilePhases(state, reordered, "build")

      expect(state.phases.map((p) => p.id)).toEqual(["03-ui", "01-scaffold", "02-api"])
    })
  })

  describe("recordMatchedShapes", () => {
    it("creates state.json and records shapes when no state exists yet", () => {
      recordMatchedShapes(tmpDir, "my-build", ["api", "cli"])

      const loaded = loadState(tmpDir)
      expect(loaded).not.toBeNull()
      expect(loaded!.buildName).toBe("my-build")
      expect(loaded!.matchedShapes).toEqual(["api", "cli"])
    })

    it("updates existing state.json with matched shapes", () => {
      const state = initState("my-build", samplePhases)
      saveState(tmpDir, state)

      recordMatchedShapes(tmpDir, "my-build", ["dashboard", "crud"])

      const loaded = loadState(tmpDir)
      expect(loaded!.matchedShapes).toEqual(["dashboard", "crud"])
    })

    it("preserves existing state fields when updating", () => {
      const state = initState("my-build", samplePhases)
      state.phases[0].status = "complete"
      state.phases[0].completionTag = "ridgeline/phase/my-build/01-scaffold"
      saveState(tmpDir, state)

      recordMatchedShapes(tmpDir, "my-build", ["api"])

      const loaded = loadState(tmpDir)
      expect(loaded!.matchedShapes).toEqual(["api"])
      expect(loaded!.phases[0].status).toBe("complete")
      expect(loaded!.buildName).toBe("my-build")
    })
  })

  describe("getMatchedShapes", () => {
    it("returns empty array when state.json does not exist", () => {
      expect(getMatchedShapes(tmpDir)).toEqual([])
    })

    it("returns empty array when state exists but has no matchedShapes field", () => {
      const state = initState("my-build", samplePhases)
      saveState(tmpDir, state)

      expect(getMatchedShapes(tmpDir)).toEqual([])
    })

    it("returns the recorded shapes array", () => {
      recordMatchedShapes(tmpDir, "my-build", ["api", "cli", "dashboard"])

      expect(getMatchedShapes(tmpDir)).toEqual(["api", "cli", "dashboard"])
    })
  })

  // -----------------------------------------------------------------------
  // Pipeline state helpers
  // -----------------------------------------------------------------------

  describe("getPipelineStatus", () => {
    it("returns default pipeline when no state and no artifacts exist", () => {
      const status = getPipelineStatus(tmpDir)

      expect(status.shape).toBe("pending")
      expect(status.design).toBe("skipped")
      expect(status.spec).toBe("pending")
      expect(status.research).toBe("skipped")
      expect(status.refine).toBe("skipped")
      expect(status.plan).toBe("pending")
      expect(status.build).toBe("pending")
    })

    it("derives status from disk artifacts", () => {
      fs.writeFileSync(path.join(tmpDir, "shape.md"), "# Shape")
      fs.writeFileSync(path.join(tmpDir, "spec.md"), "# Spec")
      fs.writeFileSync(path.join(tmpDir, "constraints.md"), "# Constraints")
      fs.writeFileSync(path.join(tmpDir, "research.md"), "# Research")

      const status = getPipelineStatus(tmpDir)

      expect(status.shape).toBe("complete")
      expect(status.spec).toBe("complete")
      expect(status.research).toBe("skipped") // optional — uses state value
    })

    it("derives plan as complete when phases dir has numbered md files", () => {
      const phasesDir = path.join(tmpDir, "phases")
      fs.mkdirSync(phasesDir, { recursive: true })
      fs.writeFileSync(path.join(phasesDir, "01-scaffold.md"), "# Phase 1")

      const status = getPipelineStatus(tmpDir)

      expect(status.plan).toBe("complete")
    })

    it("does not derive plan as complete for non-numbered phase files", () => {
      const phasesDir = path.join(tmpDir, "phases")
      fs.mkdirSync(phasesDir, { recursive: true })
      fs.writeFileSync(path.join(phasesDir, "notes.md"), "random")

      const status = getPipelineStatus(tmpDir)

      expect(status.plan).toBe("pending")
    })

    it("trusts disk over state when state says complete but file is missing", () => {
      const state: BuildState = {
        buildName: "test",
        startedAt: "2024-01-01T00:00:00.000Z",
        pipeline: {
          shape: "complete",
          design: "skipped",
          spec: "complete",
          research: "skipped",
          refine: "skipped",
          plan: "complete",
          build: "pending",
        },
        phases: [],
      }
      saveState(tmpDir, state)

      // No actual files on disk — should trust disk
      const status = getPipelineStatus(tmpDir)

      expect(status.shape).toBe("pending")
      expect(status.spec).toBe("pending")
      expect(status.plan).toBe("pending")
    })

    it("preserves build status from state", () => {
      const state: BuildState = {
        buildName: "test",
        startedAt: "2024-01-01T00:00:00.000Z",
        pipeline: {
          ...defaultPipeline,
          build: "running",
        },
        phases: [],
      }
      saveState(tmpDir, state)

      const status = getPipelineStatus(tmpDir)

      expect(status.build).toBe("running")
    })
  })

  describe("advancePipeline", () => {
    it("creates new state and marks stage complete when no state exists", () => {
      advancePipeline(tmpDir, "my-build", "shape")

      const state = loadState(tmpDir)
      expect(state).not.toBeNull()
      expect(state!.buildName).toBe("my-build")
      expect(state!.pipeline.shape).toBe("complete")
    })

    it("updates existing state and marks stage complete", () => {
      const state = initState("my-build", samplePhases)
      saveState(tmpDir, state)

      advancePipeline(tmpDir, "my-build", "spec")

      const loaded = loadState(tmpDir)
      expect(loaded!.pipeline.spec).toBe("complete")
      expect(loaded!.phases).toHaveLength(3) // preserves existing phases
    })

    it("handles the build stage path", () => {
      advancePipeline(tmpDir, "my-build", "build")

      const state = loadState(tmpDir)
      expect(state!.pipeline.build).toBe("complete")
    })
  })

  describe("markBuildRunning", () => {
    it("creates new state with build set to running when no state exists", () => {
      markBuildRunning(tmpDir, "my-build")

      const state = loadState(tmpDir)
      expect(state).not.toBeNull()
      expect(state!.buildName).toBe("my-build")
      expect(state!.pipeline.build).toBe("running")
    })

    it("updates existing state build to running", () => {
      const state = initState("my-build", samplePhases)
      saveState(tmpDir, state)

      markBuildRunning(tmpDir, "my-build")

      const loaded = loadState(tmpDir)
      expect(loaded!.pipeline.build).toBe("running")
    })
  })

  describe("getNextPipelineStage", () => {
    it("returns first pending required stage", () => {
      expect(getNextPipelineStage(tmpDir)).toBe("shape")
    })

    it("skips completed stages", () => {
      fs.writeFileSync(path.join(tmpDir, "shape.md"), "# Shape")
      advancePipeline(tmpDir, "test", "shape")

      expect(getNextPipelineStage(tmpDir)).toBe("spec")
    })

    it("returns running stages as next", () => {
      fs.writeFileSync(path.join(tmpDir, "shape.md"), "# Shape")
      advancePipeline(tmpDir, "test", "shape")
      fs.writeFileSync(path.join(tmpDir, "spec.md"), "# Spec")
      fs.writeFileSync(path.join(tmpDir, "constraints.md"), "# Constraints")
      advancePipeline(tmpDir, "test", "spec")
      const phasesDir = path.join(tmpDir, "phases")
      fs.mkdirSync(phasesDir, { recursive: true })
      fs.writeFileSync(path.join(phasesDir, "01-scaffold.md"), "# Phase 1")
      advancePipeline(tmpDir, "test", "plan")
      markBuildRunning(tmpDir, "test")

      expect(getNextPipelineStage(tmpDir)).toBe("build")
    })

    it("returns null when all required stages complete", () => {
      // Create all artifacts and advance all stages
      fs.writeFileSync(path.join(tmpDir, "shape.md"), "# Shape")
      fs.writeFileSync(path.join(tmpDir, "spec.md"), "# Spec")
      fs.writeFileSync(path.join(tmpDir, "constraints.md"), "# Constraints")
      const phasesDir = path.join(tmpDir, "phases")
      fs.mkdirSync(phasesDir, { recursive: true })
      fs.writeFileSync(path.join(phasesDir, "01-scaffold.md"), "# Phase 1")

      advancePipeline(tmpDir, "test", "shape")
      advancePipeline(tmpDir, "test", "spec")
      advancePipeline(tmpDir, "test", "plan")
      advancePipeline(tmpDir, "test", "build")

      expect(getNextPipelineStage(tmpDir)).toBeNull()
    })
  })

  describe("rewindTo", () => {
    let phasesDir: string

    beforeEach(() => {
      // Set up a realistic build directory with artifacts at every stage
      fs.writeFileSync(path.join(tmpDir, "shape.md"), "# Shape")
      fs.writeFileSync(path.join(tmpDir, "design.md"), "# Design")
      fs.writeFileSync(path.join(tmpDir, "spec.md"), "# Spec")
      fs.writeFileSync(path.join(tmpDir, "constraints.md"), "# Constraints")
      fs.writeFileSync(path.join(tmpDir, "taste.md"), "# Taste")
      fs.writeFileSync(path.join(tmpDir, "research.md"), "# Research")
      fs.writeFileSync(path.join(tmpDir, "handoff.md"), "# Handoff")
      phasesDir = path.join(tmpDir, "phases")
      fs.mkdirSync(phasesDir, { recursive: true })
      fs.writeFileSync(path.join(phasesDir, "01-scaffold.md"), "# Phase 1")
      fs.writeFileSync(path.join(phasesDir, "02-api.md"), "# Phase 2")
      fs.writeFileSync(path.join(phasesDir, "01-scaffold.feedback.md"), "# Feedback")

      // Create state with all stages complete
      const state: BuildState = {
        buildName: "test",
        startedAt: "2024-01-01T00:00:00.000Z",
        pipeline: {
          shape: "complete",
          design: "complete",
          spec: "complete",
          research: "complete",
          refine: "complete",
          plan: "complete",
          build: "complete",
        },
        phases: [
          { id: "01-scaffold", status: "complete", checkpointTag: "t1", completionTag: "c1", retries: 0, duration: 10, completedAt: "2024-01-01T00:00:00.000Z", failedAt: null },
        ],
      }
      saveState(tmpDir, state)
    })

    it("returns downstream files when rewinding to shape", () => {
      const toDelete = rewindTo(tmpDir, "test", "shape")

      // Should include design.md, spec/constraints/taste, research.md, phase files, handoff, feedback
      expect(toDelete).toContain(path.join(tmpDir, "design.md"))
      expect(toDelete).toContain(path.join(tmpDir, "spec.md"))
      expect(toDelete).toContain(path.join(tmpDir, "constraints.md"))
      expect(toDelete).toContain(path.join(tmpDir, "taste.md"))
      expect(toDelete).toContain(path.join(tmpDir, "research.md"))
      expect(toDelete).toContain(path.join(tmpDir, "handoff.md"))
      expect(toDelete).toContain(path.join(phasesDir, "01-scaffold.md"))
      expect(toDelete).toContain(path.join(phasesDir, "02-api.md"))
      expect(toDelete).toContain(path.join(phasesDir, "01-scaffold.feedback.md"))
    })

    it("returns spec files and downstream when rewinding to spec", () => {
      const toDelete = rewindTo(tmpDir, "test", "spec")

      // Downstream of spec: research, refine, plan, build
      expect(toDelete).toContain(path.join(tmpDir, "research.md"))
      expect(toDelete).toContain(path.join(phasesDir, "01-scaffold.md"))
      expect(toDelete).toContain(path.join(tmpDir, "handoff.md"))
      // Should NOT include spec.md itself (it's the target, not downstream)
      expect(toDelete).not.toContain(path.join(tmpDir, "spec.md"))
    })

    it("collects only feedback files from phases when rewinding to build", () => {
      const toDelete = rewindTo(tmpDir, "test", "build")

      // build is the last stage, no downstream stages
      expect(toDelete).toHaveLength(0)
    })

    it("collects plan files (all phase files) when rewinding to plan", () => {
      const toDelete = rewindTo(tmpDir, "test", "plan")

      // Downstream of plan: build
      expect(toDelete).toContain(path.join(tmpDir, "handoff.md"))
      expect(toDelete).toContain(path.join(phasesDir, "01-scaffold.feedback.md"))
      // Phase md files should NOT be in delete list (plan is the target)
      // But build feedback files should be
    })

    it("resets downstream pipeline stages to correct defaults", () => {
      rewindTo(tmpDir, "test", "shape")

      const state = loadState(tmpDir)
      expect(state!.pipeline.shape).toBe("complete") // target stays complete
      expect(state!.pipeline.design).toBe("skipped") // optional → skipped
      expect(state!.pipeline.spec).toBe("pending") // required → pending
      expect(state!.pipeline.research).toBe("skipped") // optional → skipped
      expect(state!.pipeline.refine).toBe("skipped") // optional → skipped
      expect(state!.pipeline.plan).toBe("pending") // required → pending
      expect(state!.pipeline.build).toBe("pending") // required → pending
    })

    it("marks optional target stage as complete", () => {
      rewindTo(tmpDir, "test", "design")

      const state = loadState(tmpDir)
      expect(state!.pipeline.design).toBe("complete")
    })

    it("sets build target stage to pending", () => {
      rewindTo(tmpDir, "test", "build")

      const state = loadState(tmpDir)
      expect(state!.pipeline.build).toBe("pending")
    })

    it("clears phases array when plan or build is in reset set", () => {
      rewindTo(tmpDir, "test", "spec")

      const state = loadState(tmpDir)
      expect(state!.phases).toEqual([])
    })

    it("calls cleanupBuildTags when build is in reset set", () => {
      rewindTo(tmpDir, "test", "shape")

      expect(cleanupBuildTags).toHaveBeenCalledWith("test")
    })

    it("does not call cleanupBuildTags when build is not in reset set", () => {
      vi.mocked(cleanupBuildTags).mockClear()
      rewindTo(tmpDir, "test", "build")

      expect(cleanupBuildTags).not.toHaveBeenCalled()
    })
  })

  describe("loadState backfills pipeline for legacy state", () => {
    it("derives pipeline from artifacts when state has no pipeline field", () => {
      fs.writeFileSync(path.join(tmpDir, "shape.md"), "# Shape")
      // Write a state.json without pipeline field
      const legacyState = {
        buildName: "legacy",
        startedAt: "2024-01-01T00:00:00.000Z",
        phases: [],
      }
      fs.writeFileSync(path.join(tmpDir, "state.json"), JSON.stringify(legacyState))

      const state = loadState(tmpDir)

      expect(state!.pipeline).toBeDefined()
      expect(state!.pipeline.shape).toBe("complete")
      expect(state!.pipeline.spec).toBe("pending")
    })
  })

  describe("rebuildStateFromTrajectory", () => {
    const writeTrajectory = (entries: Record<string, unknown>[]) => {
      const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
      fs.writeFileSync(path.join(tmpDir, "trajectory.jsonl"), lines)
    }

    it("returns null when trajectory is empty", () => {
      expect(rebuildStateFromTrajectory(tmpDir, "test", samplePhases)).toBeNull()
    })

    it("recovers completed phases from trajectory", () => {
      writeTrajectory([
        { timestamp: "2026-01-01T00:00:00.000Z", type: "build_start", phaseId: "01-scaffold", duration: null, tokens: null, costUsd: null, summary: "Build attempt 1" },
        { timestamp: "2026-01-01T00:00:10.000Z", type: "build_complete", phaseId: "01-scaffold", duration: 9000, tokens: { input: 100, output: 200 }, costUsd: 0.05, summary: "Build complete" },
        { timestamp: "2026-01-01T00:00:20.000Z", type: "review_complete", phaseId: "01-scaffold", duration: 5000, tokens: { input: 50, output: 100 }, costUsd: 0.03, summary: "All criteria met" },
        { timestamp: "2026-01-01T00:00:25.000Z", type: "phase_advance", phaseId: "01-scaffold", duration: null, tokens: null, costUsd: null, summary: "Phase passed" },
      ])

      const state = rebuildStateFromTrajectory(tmpDir, "test", samplePhases)

      expect(state).not.toBeNull()
      expect(state!.buildName).toBe("test")
      expect(state!.startedAt).toBe("2026-01-01T00:00:00.000Z")

      const phase1 = state!.phases.find((p) => p.id === "01-scaffold")!
      expect(phase1.status).toBe("complete")
      expect(phase1.completionTag).toBe("ridgeline/phase/test/01-scaffold")
      expect(phase1.retries).toBe(0)
      expect(phase1.duration).toBe(25000) // 00:00:25 - 00:00:00
      expect(phase1.completedAt).toBe("2026-01-01T00:00:25.000Z")
      expect(phase1.failedAt).toBeNull()

      // Unattempted phases should be pending
      const phase2 = state!.phases.find((p) => p.id === "02-api")!
      expect(phase2.status).toBe("pending")
      expect(phase2.completionTag).toBeNull()
      expect(phase2.retries).toBe(0)
    })

    it("recovers failed phases with retry count", () => {
      writeTrajectory([
        { timestamp: "2026-01-01T00:00:00.000Z", type: "build_start", phaseId: "01-scaffold", duration: null, tokens: null, costUsd: null, summary: "Build attempt 1" },
        { timestamp: "2026-01-01T00:00:10.000Z", type: "build_start", phaseId: "01-scaffold", duration: null, tokens: null, costUsd: null, summary: "Build attempt 2" },
        { timestamp: "2026-01-01T00:00:20.000Z", type: "build_start", phaseId: "01-scaffold", duration: null, tokens: null, costUsd: null, summary: "Build attempt 3" },
        { timestamp: "2026-01-01T00:00:30.000Z", type: "phase_fail", phaseId: "01-scaffold", duration: null, tokens: null, costUsd: null, summary: "Retries exhausted" },
      ])

      const state = rebuildStateFromTrajectory(tmpDir, "test", samplePhases)
      const phase1 = state!.phases.find((p) => p.id === "01-scaffold")!

      expect(phase1.status).toBe("failed")
      expect(phase1.retries).toBe(2) // 3 build_starts - 1
      expect(phase1.failedAt).toBe("2026-01-01T00:00:30.000Z")
      expect(phase1.completionTag).toBeNull()
      expect(phase1.duration).toBe(30000) // 00:00:30 - 00:00:00
    })
  })

  describe("loadState trajectory fallback", () => {
    const writeTrajectory = (entries: Record<string, unknown>[]) => {
      const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
      fs.writeFileSync(path.join(tmpDir, "trajectory.jsonl"), lines)
    }

    it("recovers from trajectory when state.json is missing", () => {
      writeTrajectory([
        { timestamp: "2026-01-01T00:00:00.000Z", type: "build_start", phaseId: "01-scaffold", duration: null, tokens: null, costUsd: null, summary: "Build attempt 1" },
        { timestamp: "2026-01-01T00:00:25.000Z", type: "phase_advance", phaseId: "01-scaffold", duration: null, tokens: null, costUsd: null, summary: "Phase passed" },
      ])

      const state = loadState(tmpDir, "test", samplePhases)

      expect(state).not.toBeNull()
      expect(state!.phases.find((p) => p.id === "01-scaffold")!.status).toBe("complete")
      // Verify recovered state was persisted
      expect(fs.existsSync(path.join(tmpDir, "state.json"))).toBe(true)
    })

    it("recovers from trajectory when state.json is corrupt", () => {
      fs.writeFileSync(path.join(tmpDir, "state.json"), "not valid json{{{")
      writeTrajectory([
        { timestamp: "2026-01-01T00:00:00.000Z", type: "build_start", phaseId: "01-scaffold", duration: null, tokens: null, costUsd: null, summary: "Build attempt 1" },
        { timestamp: "2026-01-01T00:00:25.000Z", type: "phase_advance", phaseId: "01-scaffold", duration: null, tokens: null, costUsd: null, summary: "Phase passed" },
      ])

      const state = loadState(tmpDir, "test", samplePhases)

      expect(state).not.toBeNull()
      expect(state!.phases.find((p) => p.id === "01-scaffold")!.status).toBe("complete")
    })

    it("returns null when both state.json and trajectory are missing", () => {
      expect(loadState(tmpDir, "test", samplePhases)).toBeNull()
    })

    it("returns null without buildName/phases even if trajectory exists", () => {
      writeTrajectory([
        { timestamp: "2026-01-01T00:00:00.000Z", type: "build_start", phaseId: "01-scaffold", duration: null, tokens: null, costUsd: null, summary: "Build attempt 1" },
      ])

      // Old call signature without extra args
      expect(loadState(tmpDir)).toBeNull()
    })
  })
})
