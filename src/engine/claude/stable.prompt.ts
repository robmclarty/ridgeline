import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"

export interface StablePromptParts {
  constraintsMd: string
  tasteMd?: string | null
  specMd?: string | null
}

export interface StablePromptFile {
  path: string
  hash: string
  tokenEstimate: number
}

export type HelpRunner = () => string

export const buildStablePrompt = (parts: StablePromptParts): string => {
  const sections: string[] = []
  sections.push(`## constraints.md\n\n${parts.constraintsMd.trimEnd()}\n`)
  if (parts.tasteMd && parts.tasteMd.trim().length > 0) {
    sections.push(`## taste.md\n\n${parts.tasteMd.trimEnd()}\n`)
  }
  if (parts.specMd && parts.specMd.trim().length > 0) {
    sections.push(`## spec.md\n\n${parts.specMd.trimEnd()}\n`)
  }
  return sections.join("\n")
}

export const computeStableHash = (content: string): string =>
  createHash("sha256").update(content).digest("hex")

const trackedTempFiles = new Set<string>()
let cleanupRegistered = false

const registerCleanup = (): void => {
  if (cleanupRegistered) return
  cleanupRegistered = true
  process.on("exit", () => {
    for (const fp of trackedTempFiles) {
      try { fs.unlinkSync(fp) } catch { /* best-effort */ }
    }
  })
}

/**
 * Write (or reuse) the stable-block temp file named by sha256 of its content.
 * Files persist for the process lifetime and are unlinked on exit.
 */
export const writeStablePromptFile = (content: string): StablePromptFile => {
  const hash = computeStableHash(content)
  const fp = path.join(os.tmpdir(), `ridgeline-stable-${hash}.md`)
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, content)
  }
  trackedTempFiles.add(fp)
  registerCleanup()
  return { path: fp, hash, tokenEstimate: approximateTokenCount(content) }
}

/** Rough 4 chars ≈ 1 token heuristic; sufficient for the preflight threshold check. */
export const approximateTokenCount = (content: string): number =>
  Math.ceil(content.length / 4)

/**
 * Minimum cacheable prefix in tokens per model family.
 * Opus 4.5/4.6/4.7 and Haiku 4.5 → 4,096; Sonnet 4.6 → 2,048.
 */
export const minCacheableTokens = (model: string): number => {
  const m = model.toLowerCase()
  if (m.includes("sonnet")) return 2048
  return 4096
}

const defaultHelpRunner: HelpRunner = () => {
  const r = spawnSync("claude", ["--help"], { encoding: "utf-8", timeout: 10000 })
  return `${r.stdout ?? ""}${r.stderr ?? ""}`
}

let cachedFlagDetection: boolean | null = null

export const detectExcludeDynamicFlag = (runner?: HelpRunner): boolean => {
  if (cachedFlagDetection !== null) return cachedFlagDetection
  try {
    const help = (runner ?? defaultHelpRunner)()
    cachedFlagDetection = help.includes("--exclude-dynamic-system-prompt-sections")
  } catch {
    cachedFlagDetection = false
  }
  return cachedFlagDetection
}

let unavailableLogged = false

export const shouldLogUnavailableOnce = (): boolean => {
  if (unavailableLogged) return false
  unavailableLogged = true
  return true
}

/** Test helper: reset internal module state. */
export const __resetStablePromptState = (): void => {
  cachedFlagDetection = null
  unavailableLogged = false
  trackedTempFiles.clear()
  cleanupRegistered = false
}

/** Test helper: inspect tracked files (read-only snapshot). */
export const __trackedTempFiles = (): string[] => [...trackedTempFiles]
