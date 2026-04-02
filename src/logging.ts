import * as fs from "node:fs"
import * as path from "node:path"
import { TrajectoryEntry } from "./types"

export const logInfo = (msg: string): void => {
  console.log(`[ridgeline] ${msg}`)
}

export const logError = (msg: string): void => {
  console.error(`[ridgeline] ERROR: ${msg}`)
}

export const logPhase = (phaseId: string, msg: string): void => {
  console.log(`[ridgeline] [${phaseId}] ${msg}`)
}

export const logTrajectory = (buildDir: string, entry: TrajectoryEntry): void => {
  const filepath = path.join(buildDir, "trajectory.jsonl")
  fs.appendFileSync(filepath, JSON.stringify(entry) + "\n")
}

export const makeTrajectoryEntry = (
  type: TrajectoryEntry["type"],
  phaseId: string | null,
  summary: string,
  opts?: {
    duration?: number
    tokens?: { input: number; output: number }
    costUsd?: number
  }
): TrajectoryEntry => ({
  timestamp: new Date().toISOString(),
  type,
  phaseId,
  duration: opts?.duration ?? null,
  tokens: opts?.tokens ?? null,
  costUsd: opts?.costUsd ?? null,
  summary,
})
