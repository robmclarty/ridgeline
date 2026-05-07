import { describe, it, expect, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../../test/setup"
import { TrajectoryEntry } from "../../../types"
import {
  createRidgelineTrajectoryLogger,
  emitTrajectoryEntry,
  isRidgelineTrajectoryEvent,
  RIDGELINE_TRAJECTORY_KIND,
} from "../ridgeline_trajectory_logger"

const baselinePath = path.join(
  process.cwd(),
  ".ridgeline", "builds", "fascicle-migration", "baseline", "fixtures", "trajectory.jsonl",
)

describe("ridgeline_trajectory_logger", () => {
  let dir: string

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  describe("createRidgelineTrajectoryLogger", () => {
    it("appends a single ridgeline_trajectory event as a JSON line", () => {
      dir = makeTempDir()
      const logger = createRidgelineTrajectoryLogger({ buildDir: dir })

      const entry: TrajectoryEntry = {
        timestamp: "2026-04-02T15:56:23.753Z",
        type: "plan_start",
        phaseId: null,
        duration: null,
        tokens: null,
        costUsd: null,
        summary: "Planning started",
      }
      logger.record({ kind: RIDGELINE_TRAJECTORY_KIND, entry })

      const written = fs.readFileSync(path.join(dir, "trajectory.jsonl"), "utf-8")
      expect(written).toBe(JSON.stringify(entry) + "\n")
    })

    it("ignores non-ridgeline events", () => {
      dir = makeTempDir()
      const logger = createRidgelineTrajectoryLogger({ buildDir: dir })

      logger.record({ kind: "span_start", span_id: "x", name: "phase" })
      logger.record({ kind: "emit", payload: "anything" })
      logger.start_span("foo")
      logger.end_span("foo:1")

      const fp = path.join(dir, "trajectory.jsonl")
      expect(fs.existsSync(fp)).toBe(false)
    })

    it("emitTrajectoryEntry helper produces a valid event", () => {
      dir = makeTempDir()
      const logger = createRidgelineTrajectoryLogger({ buildDir: dir })

      const entry: TrajectoryEntry = {
        timestamp: "2026-04-02T15:57:10.214Z",
        type: "build_complete",
        phaseId: "01-hello-script",
        duration: 27336,
        tokens: { input: 8, output: 832 },
        costUsd: 0.177659,
        summary: "Build complete",
      }
      emitTrajectoryEntry(logger, entry)

      const written = fs.readFileSync(path.join(dir, "trajectory.jsonl"), "utf-8")
      expect(written).toBe(JSON.stringify(entry) + "\n")
    })

    it("preserves byte equality across the baseline trajectory.jsonl fixture", () => {
      dir = makeTempDir()
      const logger = createRidgelineTrajectoryLogger({ buildDir: dir })

      const baseline = fs.readFileSync(baselinePath, "utf-8")
      const lines = baseline.split("\n").filter((line) => line.length > 0)

      for (const line of lines) {
        const entry = JSON.parse(line) as TrajectoryEntry
        logger.record({ kind: RIDGELINE_TRAJECTORY_KIND, entry })
      }

      const written = fs.readFileSync(path.join(dir, "trajectory.jsonl"), "utf-8")
      expect(written).toBe(baseline)
    })

    it("produces output structurally identical to logTrajectory for the same logical sequence", async () => {
      dir = makeTempDir()
      const logger = createRidgelineTrajectoryLogger({ buildDir: dir })

      const adapterDir = path.join(dir, "adapter")
      const legacyDir = path.join(dir, "legacy")
      fs.mkdirSync(adapterDir, { recursive: true })
      fs.mkdirSync(legacyDir, { recursive: true })

      const legacyLogger = createRidgelineTrajectoryLogger({ buildDir: adapterDir })
      const { logTrajectory } = await import("../../../stores/trajectory")

      // Same logical inputs to both paths. Timestamps will differ slightly so
      // we compare structure (parsed equality minus timestamp).
      logTrajectory(legacyDir, "build_start", "01-x", "Build attempt 1")
      legacyLogger.record({
        kind: RIDGELINE_TRAJECTORY_KIND,
        entry: {
          timestamp: new Date().toISOString(),
          type: "build_start",
          phaseId: "01-x",
          duration: null,
          tokens: null,
          costUsd: null,
          summary: "Build attempt 1",
        },
      })

      const legacyLine = fs.readFileSync(path.join(legacyDir, "trajectory.jsonl"), "utf-8").trim()
      const adapterLine = fs.readFileSync(path.join(adapterDir, "trajectory.jsonl"), "utf-8").trim()

      const stripTs = (line: string): string => {
        const obj = JSON.parse(line) as Record<string, unknown>
        delete obj.timestamp
        return JSON.stringify(obj)
      }
      expect(stripTs(adapterLine)).toBe(stripTs(legacyLine))
    })

    it("appends multiple events as separate atomic JSON lines", async () => {
      dir = makeTempDir()
      const logger = createRidgelineTrajectoryLogger({ buildDir: dir })
      const buildDir = dir

      const promises = Array.from({ length: 25 }, (_, i) => {
        const entry: TrajectoryEntry = {
          timestamp: new Date().toISOString(),
          type: "build_start",
          phaseId: `${i.toString().padStart(2, "0")}-phase`,
          duration: null,
          tokens: null,
          costUsd: null,
          summary: `Concurrent emit ${i}`,
        }
        return Promise.resolve().then(() =>
          logger.record({ kind: RIDGELINE_TRAJECTORY_KIND, entry }),
        )
      })
      await Promise.all(promises)

      const lines = fs.readFileSync(path.join(buildDir, "trajectory.jsonl"), "utf-8")
        .split("\n")
        .filter((line) => line.length > 0)
      expect(lines).toHaveLength(25)
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    })

    it("structural assertion: written lines conform to the documented TrajectoryEntry schema", () => {
      dir = makeTempDir()
      const logger = createRidgelineTrajectoryLogger({ buildDir: dir })

      const baseline = fs.readFileSync(baselinePath, "utf-8")
      for (const line of baseline.split("\n").filter((l) => l.length > 0)) {
        const entry = JSON.parse(line) as TrajectoryEntry
        logger.record({ kind: RIDGELINE_TRAJECTORY_KIND, entry })
      }

      const lines = fs.readFileSync(path.join(dir, "trajectory.jsonl"), "utf-8")
        .split("\n")
        .filter((l) => l.length > 0)
      for (const line of lines) {
        const entry = JSON.parse(line) as TrajectoryEntry
        expect(typeof entry.timestamp).toBe("string")
        expect(typeof entry.type).toBe("string")
        expect("phaseId" in entry).toBe(true)
        expect("duration" in entry).toBe(true)
        expect("tokens" in entry).toBe(true)
        expect("costUsd" in entry).toBe(true)
        expect(typeof entry.summary).toBe("string")
      }
    })
  })

  describe("isRidgelineTrajectoryEvent", () => {
    it("returns true for valid ridgeline_trajectory events", () => {
      expect(
        isRidgelineTrajectoryEvent({
          kind: RIDGELINE_TRAJECTORY_KIND,
          entry: { type: "plan_start" } as unknown as TrajectoryEntry,
        }),
      ).toBe(true)
    })

    it("returns false for events of other kinds", () => {
      expect(isRidgelineTrajectoryEvent({ kind: "emit" })).toBe(false)
      expect(isRidgelineTrajectoryEvent({ kind: "span_start", span_id: "x" })).toBe(false)
    })

    it("returns false when entry is missing or malformed", () => {
      expect(isRidgelineTrajectoryEvent({ kind: RIDGELINE_TRAJECTORY_KIND })).toBe(false)
      expect(
        isRidgelineTrajectoryEvent({ kind: RIDGELINE_TRAJECTORY_KIND, entry: null }),
      ).toBe(false)
      expect(
        isRidgelineTrajectoryEvent({ kind: RIDGELINE_TRAJECTORY_KIND, entry: "bogus" }),
      ).toBe(false)
    })
  })
})
