import * as fs from "node:fs"
import * as path from "node:path"
import { TrajectoryEntry } from "../types"

const trajectoryPath = (buildDir: string): string =>
  path.join(buildDir, "trajectory.jsonl")

export type TrajectoryOpts = {
  duration?: number
  tokens?: { input: number; output: number }
  costUsd?: number
  reason?: string
  specialist?: string
  stage?: string
}

const makeEntry = (
  type: TrajectoryEntry["type"],
  phaseId: string | null,
  summary: string,
  opts?: TrajectoryOpts,
): TrajectoryEntry => ({
  timestamp: new Date().toISOString(),
  type,
  phaseId,
  duration: opts?.duration ?? null,
  tokens: opts?.tokens ?? null,
  costUsd: opts?.costUsd ?? null,
  summary,
  ...(opts?.reason ? { reason: opts.reason } : {}),
  ...(opts?.specialist ? { specialist: opts.specialist } : {}),
  ...(opts?.stage ? { stage: opts.stage } : {}),
})

export const logTrajectory = (
  buildDir: string,
  type: TrajectoryEntry["type"],
  phaseId: string | null,
  summary: string,
  opts?: TrajectoryOpts,
): void => {
  fs.appendFileSync(trajectoryPath(buildDir), JSON.stringify(makeEntry(type, phaseId, summary, opts)) + "\n")
}

// Read all trajectory entries from the JSONL file
export const readTrajectory = (buildDir: string): TrajectoryEntry[] => {
  const fp = trajectoryPath(buildDir)
  if (!fs.existsSync(fp)) return []
  return fs.readFileSync(fp, "utf-8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TrajectoryEntry)
}
