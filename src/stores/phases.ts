import * as fs from "node:fs"
import * as path from "node:path"
import { PhaseInfo } from "../types"

export const PHASE_FILENAME_PATTERN = /^\d{2}[a-z]?-.*\.md$/

export const isPhaseFile = (filename: string): boolean =>
  PHASE_FILENAME_PATTERN.test(filename) && !filename.includes(".feedback")

export const parsePhaseFilename = (filename: string): { id: string; index: number; slug: string } => {
  const match = filename.match(/^(\d{2})[a-z]?-(.+)\.md$/)
  return {
    id: filename.replace(/\.md$/, ""),
    index: match ? parseInt(match[1], 10) : 0,
    slug: match ? match[2] : filename,
  }
}

export type PhaseContent = {
  title: string
  goal: string
  criteria: string
}

/**
 * Parse YAML frontmatter from a phase file to extract depends_on.
 * Supports: depends_on: [01-scaffold, 02-data-layer]
 * Returns empty array if no frontmatter or no depends_on key.
 */
export const parsePhaseFrontmatter = (content: string): { dependsOn: string[] } => {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return { dependsOn: [] }

  const raw = match[1]
  const depMatch = raw.match(/depends_on:\s*\[([^\]]*)\]/)
  if (!depMatch) return { dependsOn: [] }

  const deps = depMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
  return { dependsOn: deps }
}

// Extract title, goal, and acceptance criteria from phase markdown content
export const parsePhaseContent = (content: string): PhaseContent => {
  const titleMatch = content.match(/^#\s+(.+)/m)
  const goalMatch = content.match(/## Goal\s*\n([\s\S]*?)(?=\n## |\n$)/)
  const criteriaMatch = content.match(/## Acceptance Criteria\s*\n([\s\S]*?)(?=\n## |\n$)/)

  return {
    title: titleMatch ? titleMatch[1] : "",
    goal: goalMatch ? goalMatch[1].trim() : "",
    criteria: criteriaMatch ? criteriaMatch[1].trim() : "",
  }
}

export const scanPhases = (phasesDir: string): PhaseInfo[] => {
  if (!fs.existsSync(phasesDir)) return []
  const files = fs.readdirSync(phasesDir)
    .filter(isPhaseFile)
    .sort()

  return files.map((filename) => {
    const { id, index, slug } = parsePhaseFilename(filename)
    const filepath = path.join(phasesDir, filename)
    const content = fs.readFileSync(filepath, "utf-8")
    const { dependsOn } = parsePhaseFrontmatter(content)

    return {
      id,
      index,
      slug,
      filename,
      filepath,
      dependsOn,
    }
  })
}
