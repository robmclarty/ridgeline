import { describe, it, expect, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import { logTrajectory, makeTrajectoryEntry, readTrajectory } from "../trajectory"

describe("trajectory", () => {
  describe("logTrajectory", () => {
    it("appends JSON line to trajectory.jsonl", () => {
      const dir = makeTempDir()
      const entry = makeTrajectoryEntry("build_start", "01-scaffold", "Build started")

      logTrajectory(dir, entry)

      const content = fs.readFileSync(path.join(dir, "trajectory.jsonl"), "utf-8")
      const parsed = JSON.parse(content.trim())
      expect(parsed.type).toBe("build_start")
      expect(parsed.phaseId).toBe("01-scaffold")
      expect(parsed.summary).toBe("Build started")

      fs.rmSync(dir, { recursive: true, force: true })
    })

    it("appends multiple entries on separate lines", () => {
      const dir = makeTempDir()
      logTrajectory(dir, makeTrajectoryEntry("build_start", "01-scaffold", "Start"))
      logTrajectory(dir, makeTrajectoryEntry("build_complete", "01-scaffold", "Done"))

      const lines = fs.readFileSync(path.join(dir, "trajectory.jsonl"), "utf-8")
        .trim()
        .split("\n")
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0]).type).toBe("build_start")
      expect(JSON.parse(lines[1]).type).toBe("build_complete")

      fs.rmSync(dir, { recursive: true, force: true })
    })
  })

  describe("makeTrajectoryEntry", () => {
    it("creates entry with required fields", () => {
      const entry = makeTrajectoryEntry("plan_start", null, "Planning started")
      expect(entry.type).toBe("plan_start")
      expect(entry.phaseId).toBeNull()
      expect(entry.summary).toBe("Planning started")
      expect(entry.duration).toBeNull()
      expect(entry.tokens).toBeNull()
      expect(entry.costUsd).toBeNull()
      expect(entry.timestamp).toBeDefined()
    })

    it("includes optional metrics when provided", () => {
      const entry = makeTrajectoryEntry("build_complete", "01-scaffold", "Done", {
        duration: 5000,
        tokens: { input: 100, output: 200 },
        costUsd: 0.05,
      })
      expect(entry.duration).toBe(5000)
      expect(entry.tokens).toEqual({ input: 100, output: 200 })
      expect(entry.costUsd).toBe(0.05)
    })

    it("generates valid ISO timestamp", () => {
      const entry = makeTrajectoryEntry("plan_start", null, "test")
      expect(() => new Date(entry.timestamp)).not.toThrow()
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp)
    })
  })

  describe("readTrajectory", () => {
    let dir: string

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })

    it("returns empty array when file does not exist", () => {
      dir = makeTempDir()
      expect(readTrajectory(dir)).toEqual([])
    })

    it("reads all entries from trajectory.jsonl", () => {
      dir = makeTempDir()
      logTrajectory(dir, makeTrajectoryEntry("build_start", "01-scaffold", "Start"))
      logTrajectory(dir, makeTrajectoryEntry("build_complete", "01-scaffold", "Done"))

      const entries = readTrajectory(dir)
      expect(entries).toHaveLength(2)
      expect(entries[0].type).toBe("build_start")
      expect(entries[1].type).toBe("build_complete")
    })
  })
})
