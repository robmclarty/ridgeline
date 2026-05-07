// Per-step intra-run memoization. Never touches state.json or git tags — those
// remain owned exclusively by stores/state.ts and stores/tags.ts so the two-tier
// resume model (cross-process outer + intra-run inner) cannot overlap.
import * as fs from "node:fs"
import * as path from "node:path"
import type { CheckpointStore } from "fascicle"
import { atomicWriteSync } from "../../utils/atomic-write"

export type RidgelineCheckpointStoreOptions = {
  readonly buildDir: string
}

const stateDir = (buildDir: string): string => path.join(buildDir, "state")

const sanitizeKey = (key: string): string => key.replace(/[^a-zA-Z0-9_.-]/g, "_")

const stepFile = (buildDir: string, key: string): string =>
  path.join(stateDir(buildDir), `${sanitizeKey(key)}.json`)

export const createRidgelineCheckpointStore = (
  options: RidgelineCheckpointStoreOptions,
): CheckpointStore => {
  const ensureDir = (): void => {
    fs.mkdirSync(stateDir(options.buildDir), { recursive: true })
  }
  return {
    get: async (key) => {
      const fp = stepFile(options.buildDir, key)
      if (!fs.existsSync(fp)) return undefined
      return JSON.parse(fs.readFileSync(fp, "utf-8")) as unknown
    },
    set: async (key, value) => {
      ensureDir()
      atomicWriteSync(stepFile(options.buildDir, key), JSON.stringify(value, null, 2) + "\n")
    },
    delete: async (key) => {
      const fp = stepFile(options.buildDir, key)
      if (fs.existsSync(fp)) fs.unlinkSync(fp)
    },
  }
}
