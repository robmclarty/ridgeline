import * as fs from "node:fs"
import * as path from "node:path"
import { parseFrontmatter, discoverAgentsInDir, buildAgentsFlag, DiscoveredAgent } from "./agent.scan"

export type SpecialistDef = {
  perspective: string
  overlay: string
}

export type AgentRegistry = {
  /** Get a core agent prompt by filename (e.g., "builder.md"). Throws if missing. */
  getCorePrompt: (filename: string) => string

  /** Get ensemble specialists for a subfolder (e.g., "planners"). */
  getSpecialists: (subfolder: string) => SpecialistDef[]

  /** Get shared context for an ensemble subfolder. Returns null if no context.md. */
  getContext: (subfolder: string) => string | null

  /** Get sub-agents from specialists/ as DiscoveredAgent[]. */
  getSubAgents: () => DiscoveredAgent[]

  /** Get the agents flag object for Claude invocation. */
  getAgentsFlag: () => Record<string, { description: string; prompt: string; model?: string }>
}

// ---------------------------------------------------------------------------
// Path resolution helpers
// ---------------------------------------------------------------------------

/** Resolve the built-in agents/ directory across dist and src layouts. */
const resolveDefaultAgentsDir = (): string | null => {
  const candidates = [
    path.join(__dirname, "..", "agents"),
    path.join(__dirname, "..", "..", "agents"),
    path.join(__dirname, "..", "..", "..", "src", "agents"),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir
  }
  return null
}

/**
 * For a given subfolder (core, planners, specifiers, specialists), return the
 * directory to use — flavour's version if present, otherwise the default.
 */
const resolveSubfolder = (
  subfolder: string,
  flavourPath: string | null,
  defaultAgentsDir: string,
): string | null => {
  if (flavourPath) {
    const flavourSub = path.join(flavourPath, subfolder)
    if (fs.existsSync(flavourSub) && fs.statSync(flavourSub).isDirectory()) {
      return flavourSub
    }
  }
  const defaultSub = path.join(defaultAgentsDir, subfolder)
  if (fs.existsSync(defaultSub) && fs.statSync(defaultSub).isDirectory()) {
    return defaultSub
  }
  return null
}

// ---------------------------------------------------------------------------
// Specialist discovery (extracted from ensemble.exec.ts)
// ---------------------------------------------------------------------------

const discoverSpecialistsInDir = (
  dir: string,
  excludeFiles?: string[],
): SpecialistDef[] => {
  const exclude = new Set(excludeFiles ?? [])
  const specialists: SpecialistDef[] = []

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue
    if (exclude.has(entry)) continue

    const filepath = path.join(dir, entry)
    try {
      const content = fs.readFileSync(filepath, "utf-8")
      const fm = parseFrontmatter(content)
      if (!fm) continue

      const perspectiveMatch = content.match(/^perspective:\s*(.+)$/m)
      const perspective = perspectiveMatch ? perspectiveMatch[1].trim() : fm.name

      const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim()
      if (!body) continue

      specialists.push({ perspective, overlay: body })
    } catch {
      // Skip unreadable files
    }
  }

  return specialists
}

// ---------------------------------------------------------------------------
// Registry builder
// ---------------------------------------------------------------------------

/**
 * Build an agent registry that resolves agents from an optional flavour
 * directory with per-subfolder fallback to the generic defaults in src/agents/.
 */
export const buildAgentRegistry = (flavourPath: string | null): AgentRegistry => {
  const defaultAgentsDir = resolveDefaultAgentsDir()
  if (!defaultAgentsDir) {
    throw new Error("Built-in agents directory not found")
  }

  const getCorePrompt = (filename: string): string => {
    const coreDir = resolveSubfolder("core", flavourPath, defaultAgentsDir)
    if (!coreDir) throw new Error("No core agents directory found")

    const filepath = path.join(coreDir, filename)
    if (!fs.existsSync(filepath)) {
      throw new Error(`Core agent not found: ${filename}`)
    }
    return fs.readFileSync(filepath, "utf-8")
  }

  const getSpecialists = (subfolder: string): SpecialistDef[] => {
    const dir = resolveSubfolder(subfolder, flavourPath, defaultAgentsDir)
    if (!dir) return []
    return discoverSpecialistsInDir(dir, ["context.md"])
  }

  const getContext = (subfolder: string): string | null => {
    const dir = resolveSubfolder(subfolder, flavourPath, defaultAgentsDir)
    if (!dir) return null

    const contextPath = path.join(dir, "context.md")
    if (!fs.existsSync(contextPath)) return null
    return fs.readFileSync(contextPath, "utf-8")
  }

  const getSubAgents = (): DiscoveredAgent[] => {
    const dir = resolveSubfolder("specialists", flavourPath, defaultAgentsDir)
    if (!dir) return []
    return discoverAgentsInDir(dir)
  }

  const getAgentsFlag = () => {
    return buildAgentsFlag(getSubAgents())
  }

  return { getCorePrompt, getSpecialists, getContext, getSubAgents, getAgentsFlag }
}
