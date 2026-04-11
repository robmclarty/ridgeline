import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig } from "../../types"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { resolveFlavour } from "../discovery/flavour.resolve"
import { discoverPluginDirs, getCorePluginDir, PluginDir } from "../discovery/plugin.scan"
import { printError } from "../../ui/output"

/**
 * Discover agents and plugins, including the core hooks plugin in unsafe mode.
 */
export const prepareAgentsAndPlugins = (config: RidgelineConfig): {
  agents: Record<string, { description: string; prompt: string; model?: string }> | undefined
  pluginDirs: PluginDir[]
} => {
  const registry = buildAgentRegistry(resolveFlavour(config.flavour))
  const agents = registry.getAgentsFlag()
  const pluginDirs = discoverPluginDirs(config)

  if (config.unsafe && !config.sandboxProvider) {
    const coreDir = getCorePluginDir()
    if (coreDir) {
      pluginDirs.push({ dir: coreDir, createdPluginJson: false })
    }
  }

  return {
    agents: Object.keys(agents).length > 0 ? agents : undefined,
    pluginDirs,
  }
}

/**
 * Create an onStderr callback that surfaces auth errors and critical messages.
 */
export const createStderrHandler = (label?: string): ((text: string) => void) => {
  const prefix = label ? `[${label}] ` : ""
  return (text: string) => {
    const lower = text.toLowerCase()
    if (lower.includes("error") || lower.includes("auth") || lower.includes("unauthorized") || lower.includes("forbidden")) {
      printError(`${prefix}claude stderr: ${text.trim()}`)
    }
  }
}

/**
 * Format a specialist perspective name as a markdown heading with tradeoffs.
 * Shared by ensemble synthesizer prompt builders.
 */
export const formatProposalHeading = (
  sections: string[],
  perspective: string,
  tradeoffs: string,
): void => {
  sections.push(`### ${perspective.charAt(0).toUpperCase() + perspective.slice(1)} Specialist\n`)
  sections.push(`**Tradeoffs:** ${tradeoffs}\n`)
}

/**
 * Map PluginDir[] to string[] for invokeClaude, or undefined if empty.
 */
const pluginDirPaths = (dirs: PluginDir[]): string[] | undefined =>
  dirs.length > 0 ? dirs.map((p) => p.dir) : undefined

/**
 * Append constraints.md and optional taste.md sections to a prompt sections array.
 */
export const appendConstraintsAndTaste = (sections: string[], config: RidgelineConfig): void => {
  sections.push("## constraints.md\n")
  sections.push(fs.readFileSync(config.constraintsPath, "utf-8"))
  sections.push("")

  if (config.tastePath) {
    sections.push("## taste.md\n")
    sections.push(fs.readFileSync(config.tastePath, "utf-8"))
    sections.push("")
  }

  if (config.extraContext) {
    sections.push("## Additional Context\n")
    sections.push(config.extraContext)
    sections.push("")
  }
}

/**
 * Append design.md sections to a prompt sections array.
 * Checks both project-level (.ridgeline/design.md) and feature-level (buildDir/design.md).
 * Both can coexist — injected as separate labeled sections.
 */
export const appendDesign = (sections: string[], config: RidgelineConfig): void => {
  const projectDesignPath = path.join(config.ridgelineDir, "design.md")
  const featureDesignPath = path.join(config.buildDir, "design.md")

  const hasProject = fs.existsSync(projectDesignPath)
  const hasFeature = fs.existsSync(featureDesignPath)

  if (hasProject) {
    sections.push("## Project Design\n")
    sections.push(fs.readFileSync(projectDesignPath, "utf-8"))
    sections.push("")
  }

  if (hasFeature) {
    sections.push("## Feature Design\n")
    sections.push(fs.readFileSync(featureDesignPath, "utf-8"))
    sections.push("")
  }
}

/**
 * Build the common invokeClaude options shared across pipeline agents.
 */
export const commonInvokeOptions = (
  config: RidgelineConfig,
  prepared: { agents: ReturnType<typeof prepareAgentsAndPlugins>["agents"]; pluginDirs: PluginDir[] },
  onStdout: (chunk: string) => void
) => ({
  agents: prepared.agents,
  pluginDirs: pluginDirPaths(prepared.pluginDirs),
  cwd: process.cwd(),
  timeoutMs: config.timeoutMinutes * 60 * 1000,
  onStdout,
  onStderr: createStderrHandler(),
  sandboxProvider: config.sandboxProvider,
  networkAllowlist: config.networkAllowlist,
  additionalWritePaths: [config.buildDir],
})

