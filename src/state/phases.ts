import * as fs from "node:fs"
import * as path from "node:path"
import { PhaseInfo } from "../types"

export const PHASE_FILENAME_PATTERN = /^\d{2}-.*\.md$/

export const isPhaseFile = (filename: string): boolean =>
  PHASE_FILENAME_PATTERN.test(filename) && !filename.includes(".feedback")

export const parsePhaseFilename = (filename: string): { id: string; index: number; slug: string } => {
  const match = filename.match(/^(\d{2})-(.+)\.md$/)
  return {
    id: filename.replace(/\.md$/, ""),
    index: match ? parseInt(match[1], 10) : 0,
    slug: match ? match[2] : filename,
  }
}

export const scanPhases = (phasesDir: string): PhaseInfo[] => {
  if (!fs.existsSync(phasesDir)) return []
  const files = fs.readdirSync(phasesDir)
    .filter(isPhaseFile)
    .sort()

  return files.map((filename) => {
    const { id, index, slug } = parsePhaseFilename(filename)
    return {
      id,
      index,
      slug,
      filename,
      filepath: path.join(phasesDir, filename),
    }
  })
}
