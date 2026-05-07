import { buildStablePrompt, type StablePromptParts } from "../claude/stable.prompt"
import type { AtomPromptDocument } from "./_prompt.document"

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

export type StableInputs = StablePromptParts

export const composeSystemPrompt = (roleSystem: string, stable: StableInputs | null | undefined): string => {
  if (!stable) return roleSystem
  const stableBlock = buildStablePrompt(stable)
  return roleSystem.length > 0 ? `${stableBlock}\n${roleSystem}` : stableBlock
}

export const appendConstraintsAndTasteData = (
  doc: AtomPromptDocument,
  parts: { constraintsMd: string; tasteMd?: string | null; extraContext?: string | null },
): void => {
  doc.data("constraints.md", parts.constraintsMd)
  if (parts.tasteMd) {
    doc.data("taste.md", parts.tasteMd)
  }
  if (parts.extraContext) {
    doc.data("Additional Context", parts.extraContext)
  }
}

export const appendDesignData = (
  doc: AtomPromptDocument,
  parts: { projectDesignMd?: string | null; featureDesignMd?: string | null },
): void => {
  if (parts.projectDesignMd) {
    doc.data("Project Design", parts.projectDesignMd)
  }
  if (parts.featureDesignMd) {
    doc.data("Feature Design", parts.featureDesignMd)
  }
}

export const appendAssetCatalogInstruction = (doc: AtomPromptDocument, catalogPath: string | null | undefined): void => {
  if (!catalogPath) return
  doc.instruction(
    "Available Assets",
    `Read the asset catalog at ${catalogPath} to understand what visual assets are available and how to use them. ` +
    "Do NOT attempt to interpret image files directly. The catalog contains visual descriptions, dimensions, " +
    "animation metadata, and usage hints for every asset.\n\n" +
    ASSET_USAGE_INSTRUCTIONS,
  )
}
