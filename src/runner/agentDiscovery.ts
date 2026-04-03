import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig } from "../types"

export type AgentTier = "build" | "project" | "builtin"

export type DiscoveredAgent = {
  name: string
  description: string
  prompt: string
  model: string | null
  tier: AgentTier
  filename: string
}

type Frontmatter = {
  name: string
  description: string
  model: string | null
}

export const parseFrontmatter = (content: string): Frontmatter | null => {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null

  const block = match[1]
  const nameMatch = block.match(/^name:\s*(.+)$/m)
  const descMatch = block.match(/^description:\s*(.+)$/m)
  if (!nameMatch || !descMatch) return null

  const modelMatch = block.match(/^model:\s*(.+)$/m)

  return {
    name: nameMatch[1].trim(),
    description: descMatch[1].trim(),
    model: modelMatch ? modelMatch[1].trim() : null,
  }
}

export const resolveBuiltinAgentsDir = (): string | null => {
  const candidates = [
    path.join(__dirname, "agents"),
    path.join(__dirname, "..", "agents"),
    path.join(__dirname, "..", "..", "src", "agents"),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir
  }
  return null
}

export const loadExcludeList = (): Set<string> => {
  const dir = resolveBuiltinAgentsDir()
  if (!dir) return new Set()

  const corePath = path.join(dir, ".core")
  if (!fs.existsSync(corePath)) return new Set()

  const content = fs.readFileSync(corePath, "utf-8")
  const filenames = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))

  return new Set(filenames)
}

export const discoverAgentsInDir = (
  dir: string,
  tier: AgentTier,
  excludeSet: Set<string>
): DiscoveredAgent[] => {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return []

  const agents: DiscoveredAgent[] = []

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".md") || excludeSet.has(entry)) continue

    const filepath = path.join(dir, entry)
    try {
      const content = fs.readFileSync(filepath, "utf-8")
      const fm = parseFrontmatter(content)
      if (!fm) continue

      agents.push({
        name: fm.name,
        description: fm.description,
        prompt: content,
        model: fm.model,
        tier,
        filename: entry,
      })
    } catch {
      // Skip unreadable files
    }
  }

  return agents
}

export const discoverSpecialistAgents = (
  config: RidgelineConfig
): DiscoveredAgent[] => {
  const excludeSet = loadExcludeList()

  const buildAgentsDir = path.join(config.buildDir, "agents")
  const projectAgentsDir = path.join(config.ridgelineDir, "agents")
  const builtinDir = resolveBuiltinAgentsDir()

  // Scan tiers in priority order: build > project > builtin
  const buildAgents = discoverAgentsInDir(buildAgentsDir, "build", new Set())
  const projectAgents = discoverAgentsInDir(projectAgentsDir, "project", new Set())
  const builtinAgents = builtinDir
    ? discoverAgentsInDir(builtinDir, "builtin", excludeSet)
    : []

  // Deduplicate by name: higher-priority tier wins
  const seen = new Map<string, DiscoveredAgent>()
  for (const agent of [...builtinAgents, ...projectAgents, ...buildAgents]) {
    seen.set(agent.name, agent)
  }

  return Array.from(seen.values())
}

const TIER_PREFIXES: Record<AgentTier, string | null> = {
  build: "[build specialist]",
  project: "[project specialist]",
  builtin: null,
}

export const buildAgentsFlag = (
  agents: DiscoveredAgent[]
): Record<string, { description: string; prompt: string; model?: string }> => {
  const result: Record<string, { description: string; prompt: string; model?: string }> = {}

  for (const agent of agents) {
    const prefix = TIER_PREFIXES[agent.tier]
    const description = prefix
      ? `${prefix} ${agent.description}`
      : agent.description

    const entry: { description: string; prompt: string; model?: string } = {
      description,
      prompt: agent.prompt,
    }
    if (agent.model) entry.model = agent.model

    result[agent.name] = entry
  }

  return result
}
