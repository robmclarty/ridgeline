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

const ASSET_USAGE_INSTRUCTIONS = `Key rules for using assets:
- Load packed atlases from ./assets/packed/ using their JSON manifests
- Use the spritesheet JSON frame data for animations, never hardcode pixel offsets
- Respect the suggested_anchor for positioning (bottom-center for characters, top-left for tiles and backgrounds)
- Respect the suggested_z_layer for render ordering
- Use nearest-neighbor scaling for pixel art (CSS: image-rendering: pixelated)
- Layout assets marked is_reference_only are mockups, not in-game graphics.
  Read their layout_regions to understand spatial arrangement and build the
  equivalent in code using the actual UI assets.
- Tile assets marked is_tileable can be repeated to fill areas
- Background assets go behind everything, at z_layer "background"
- For React: use <img> or <canvas> with the atlas JSON data
- For PixiJS: use PIXI.Spritesheet with the packed JSON directly
- The catalog may contain warnings about palette mismatches or other suggestions.
  These are informational only. Trust the user's asset files as provided.`

/**
 * Append asset catalog reference to a prompt sections array.
 * Checks both build-level and project-level catalog paths.
 * Injects by file path reference (not inlined) to keep prompts lean.
 */
export const appendAssetCatalog = (sections: string[], config: RidgelineConfig): void => {
  const buildCatalogPath = path.join(config.buildDir, "asset-catalog.json")
  const projectCatalogPath = path.join(config.ridgelineDir, "asset-catalog.json")
  const catalogPath = fs.existsSync(buildCatalogPath)
    ? buildCatalogPath
    : fs.existsSync(projectCatalogPath)
      ? projectCatalogPath
      : null

  if (!catalogPath) return

  sections.push("## Available Assets\n")
  sections.push(
    `Read the asset catalog at ${catalogPath} to understand what visual assets are available and how to use them. ` +
    "Do NOT attempt to interpret image files directly. The catalog contains visual descriptions, dimensions, " +
    "animation metadata, and usage hints for every asset.\n"
  )
  sections.push(ASSET_USAGE_INSTRUCTIONS)
  sections.push("")
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

