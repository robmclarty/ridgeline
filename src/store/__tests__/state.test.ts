import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import { loadState, saveState, initState, updatePhaseStatus, getNextIncompletePhase } from "../state"
import type { PhaseInfo, BuildState } from "../../types"

// Mock tags module for getNextIncompletePhase
vi.mock("../tags", () => ({
  checkpointTagName: vi.fn((buildName: string, phaseId: string) => `ridgeline/checkpoint/${buildName}/${phaseId}`),
  verifyCompletionTag: vi.fn(() => true),
}))

import { verifyCompletionTag } from "../tags"

const samplePhases: PhaseInfo[] = [
  { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: "/phases/01-scaffold.md" },
  { id: "02-api", index: 2, slug: "api", filename: "02-api.md", filepath: "/phases/02-api.md" },
  { id: "03-ui", index: 3, slug: "ui", filename: "03-ui.md", filepath: "/phases/03-ui.md" },
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
  })
})
