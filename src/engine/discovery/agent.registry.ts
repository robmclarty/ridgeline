import * as fs from "node:fs"
import * as path from "node:path"
import { parseFrontmatter, discoverAgentsInDir, buildAgentsFlag, DiscoveredAgent } from "./agent.scan"

export type SpecialistDef = {
  perspective: string
  overlay: string
}

type AgentRegistry = {
  /** Get a core agent prompt by filename (e.g., "builder.md"). Throws if missing. */
  getCorePrompt: (filename: string) => string

  /** Get ensemble specialists for a subfolder (e.g., "planners"). */
  getSpecialists: (subfolder: string) => SpecialistDef[]

  /** Get a single specialist by subfolder and filename. Returns null if not found. */
  getSpecialist: (subfolder: string, filename: string) => SpecialistDef | null

  /** Get shared context for an ensemble subfolder. Returns null if no context.md. */
  getContext: (subfolder: string) => string | null

  /** Get gap checklist for an ensemble subfolder. Falls back to base if flavour has none. */
  getGaps: (subfolder: string) => string | null

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

/** Parse a specialist .md file into a SpecialistDef, or null on failure. */
const parseSpecialistFile = (filepath: string): SpecialistDef | null => {
  try {
    const content = fs.readFileSync(filepath, "utf-8")
    const fm = parseFrontmatter(content)
    if (!fm) return null

    const perspectiveMatch = content.match(/^perspective:\s*(.+)$/m)
    const perspective = perspectiveMatch ? perspectiveMatch[1].trim() : fm.name

    const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim()
    if (!body) return null

    return { perspective, overlay: body }
  } catch {
    return null
  }
}

const discoverSpecialistsInDir = (
  dir: string,
  excludeFiles?: string[],
): SpecialistDef[] => {
  const exclude = new Set(excludeFiles ?? [])
  const specialists: SpecialistDef[] = []

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue
    if (exclude.has(entry)) continue

    const result = parseSpecialistFile(path.join(dir, entry))
    if (result) specialists.push(result)
  }

  return specialists
}

// ---------------------------------------------------------------------------
// Registry builder
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Registry cache — avoids re-scanning the filesystem on every invocation
// ---------------------------------------------------------------------------

let registryCache: { key: string; registry: AgentRegistry } | null = null

/** Clear the cached registry. Exposed for tests and flavour changes. */
export const clearRegistryCache = (): void => { registryCache = null }

/**
 * Build an agent registry that resolves agents from an optional flavour
 * directory with per-subfolder fallback to the generic defaults in src/agents/.
 * Results are cached by flavour path for the lifetime of the process.
 */
export const buildAgentRegistry = (flavourPath: string | null): AgentRegistry => {
  const cacheKey = flavourPath ?? "__default__"
  if (registryCache && registryCache.key === cacheKey) return registryCache.registry
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
    return discoverSpecialistsInDir(dir, ["context.md", "gaps.md", "visual-coherence.md"])
  }

  const getSpecialist = (subfolder: string, filename: string): SpecialistDef | null => {
    const dir = resolveSubfolder(subfolder, flavourPath, defaultAgentsDir)
    if (!dir) return null

    const filepath = path.join(dir, filename)
    if (!fs.existsSync(filepath)) return null

    return parseSpecialistFile(filepath)
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

  // Independent fallback: check flavour first, then base — unlike getContext which
  // is bound to whichever subfolder resolveSubfolder picks (whole-subfolder replacement).
  // This ensures every flavour gets at least the base gap checklist.
  const getGaps = (subfolder: string): string | null => {
    if (flavourPath) {
      const flavourGaps = path.join(flavourPath, subfolder, "gaps.md")
      if (fs.existsSync(flavourGaps)) return fs.readFileSync(flavourGaps, "utf-8")
    }
    const baseGaps = path.join(defaultAgentsDir, subfolder, "gaps.md")
    if (fs.existsSync(baseGaps)) return fs.readFileSync(baseGaps, "utf-8")
    return null
  }

  const getAgentsFlag = () => {
    return buildAgentsFlag(getSubAgents())
  }

  const registry: AgentRegistry = { getCorePrompt, getSpecialists, getSpecialist, getContext, getGaps, getSubAgents, getAgentsFlag }
  registryCache = { key: cacheKey, registry }
  return registry
}
