import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { getBundledPluginDir } from "./plugin.scan"

export type SkillAvailability = {
  name: string
  isAvailable: boolean
  compatibility: string | null
}

/**
 * Extract the compatibility string from SKILL.md frontmatter.
 */
export const parseSkillCompatibility = (content: string): string | null => {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null

  const fmMatch = match[1].match(/^compatibility:\s*(.+)$/m)
  return fmMatch ? fmMatch[1].trim() : null
}

/**
 * Extract the install command from a compatibility string.
 * Looks for patterns like (npm i -g ...) or (cargo install ...).
 */
const extractInstallCommand = (compatibility: string): string | null => {
  const match = compatibility.match(/\(([^)]*(?:npm|cargo|pip|brew)[^)]*)\)/)
  return match ? match[1] : null
}

/**
 * Extract the tool name from a compatibility string.
 * Looks for "Requires <tool-name>" pattern.
 */
const extractToolName = (compatibility: string): string | null => {
  const match = compatibility.match(/Requires\s+(\S+)/)
  return match ? match[1] : null
}

/**
 * Check if a tool is available on PATH.
 */
const isToolAvailable = (toolName: string): boolean => {
  try {
    execSync(`command -v ${toolName}`, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/**
 * Check availability of recommended skills for a flavour.
 * Reads SKILL.md files from the bundled plugin directory,
 * extracts compatibility info, and checks tool availability.
 */
export const checkRecommendedSkills = (skillNames: string[]): SkillAvailability[] => {
  if (skillNames.length === 0) return []

  const bundledRoot = getBundledPluginDir()
  if (!bundledRoot) return skillNames.map(name => ({ name, isAvailable: false, compatibility: null }))

  return skillNames.map(name => {
    // Search all plugin subdirectories for the skill
    try {
      const pluginDirs = fs.readdirSync(bundledRoot).filter(entry =>
        fs.statSync(path.join(bundledRoot, entry)).isDirectory()
      )

      for (const pluginDir of pluginDirs) {
        const skillPath = path.join(bundledRoot, pluginDir, "skills", name, "SKILL.md")
        if (!fs.existsSync(skillPath)) continue

        const content = fs.readFileSync(skillPath, "utf-8")
        const compatibility = parseSkillCompatibility(content)

        if (!compatibility) return { name, isAvailable: true, compatibility: null }

        const toolName = extractToolName(compatibility)
        const isAvailable = toolName ? isToolAvailable(toolName) : false

        return { name, isAvailable, compatibility }
      }
    } catch {
      // Skip unreadable directories
    }

    return { name, isAvailable: false, compatibility: null }
  })
}

/**
 * Format skill availability results for display.
 */
export const formatSkillAvailability = (results: SkillAvailability[]): string => {
  if (results.length === 0) return ""

  const lines: string[] = []
  lines.push("  Recommended tools for this flavour:")

  for (const { name, isAvailable } of results) {
    const icon = isAvailable ? "✓" : "✗"
    const status = isAvailable ? "(found)" : "(not found)"
    lines.push(`    ${icon} ${name.padEnd(20)} ${status}`)
  }

  const missing = results.filter(r => !r.isAvailable && r.compatibility)
  if (missing.length > 0) {
    lines.push("")
    lines.push("  Install missing tools:")
    for (const { compatibility } of missing) {
      const installCmd = extractInstallCommand(compatibility!)
      if (installCmd) lines.push(`    ${installCmd}`)
    }
    lines.push("")
    lines.push("  These are optional — ridgeline works")
    lines.push("  without them, but results improve with")
    lines.push("  them installed.")
  }

  return lines.join("\n")
}
