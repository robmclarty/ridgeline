import * as fs from "node:fs"
import * as path from "node:path"

export type DiscoveredAgent = {
  name: string
  description: string
  prompt: string
  model: string | null
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

const resolveSpecialistsDir = (): string | null => {
  const candidates = [
    path.join(__dirname, "agents", "specialists"),
    path.join(__dirname, "..", "agents", "specialists"),
    path.join(__dirname, "..", "..", "src", "agents", "specialists"),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir
  }
  return null
}

export const discoverAgentsInDir = (
  dir: string
): DiscoveredAgent[] => {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return []

  const agents: DiscoveredAgent[] = []

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue

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
        filename: entry,
      })
    } catch {
      // Skip unreadable files
    }
  }

  return agents
}

export const discoverBuiltinAgents = (): DiscoveredAgent[] => {
  const specialistsDir = resolveSpecialistsDir()
  if (!specialistsDir) return []
  return discoverAgentsInDir(specialistsDir)
}

export const buildAgentsFlag = (
  agents: DiscoveredAgent[]
): Record<string, { description: string; prompt: string; model?: string }> => {
  const result: Record<string, { description: string; prompt: string; model?: string }> = {}

  for (const agent of agents) {
    const entry: { description: string; prompt: string; model?: string } = {
      description: agent.description,
      prompt: agent.prompt,
    }
    if (agent.model) entry.model = agent.model

    result[agent.name] = entry
  }

  return result
}
