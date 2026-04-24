import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { AssetCatalog, AssetEntry, LayoutRegion } from "./types"
import { hint, warning } from "../ui/color"

type VisionOptions = {
  model: string
  isBatch: boolean
  timeoutMs: number
}

type VisionDescription = {
  description?: string
  subject?: string
  facing?: string
  pose?: string
  isSpritesheet?: boolean
  frameCount?: number
  frameDirection?: string
  isTileable?: boolean
  suggestedAnchor?: string
  suggestedZLayer?: string
  paletteColours?: string[]
  styleTags?: string[]
  animationType?: "loop" | "once" | "ping-pong" | null
  layoutRegions?: LayoutRegion[]
  isReferenceOnly?: boolean
}

const VISION_PROMPT_TEMPLATE = `You are cataloging game assets. Describe this image in structured JSON.

File: {filename}
Category (from directory): {category}
Dimensions: {width}x{height}
Has transparency: {hasAlpha}

Respond with ONLY valid JSON:
{
  "description": "brief visual description of what this image shows",
  "subject": "primary subject (e.g. 'knight character', 'stone floor tile', 'health potion')",
  "facing": "direction the subject faces, if applicable (left/right/up/down/front/camera/n-a)",
  "pose": "pose or state (idle/walking/attacking/dead/n-a)",
  "is_spritesheet": true/false,
  "frame_count": number or null,
  "frame_direction": "horizontal" or "vertical" or null,
  "is_tileable": true/false,
  "suggested_anchor": "center" or "bottom-center" or "top-left" etc,
  "suggested_z_layer": "background" or "ground" or "entity" or "foreground" or "ui" or "overlay",
  "palette_colours": ["#hex1", "#hex2", ...] (up to 6 dominant colours),
  "style_tags": ["pixel-art", "32x32", "top-down", etc],
  "animation_type": "loop" or "once" or "ping-pong" or null
}`

const LAYOUT_VISION_PROMPT_TEMPLATE = `You are cataloging game UI layout mockups. Analyze this image and describe the spatial arrangement of UI elements.

File: {filename}
Dimensions: {width}x{height}

Respond with ONLY valid JSON:
{
  "description": "overall description of this layout mockup",
  "is_reference_only": true,
  "layout_regions": [
    { "area": "top-left/top-right/center/bottom-center/etc", "content": "what UI element is here", "assets_referenced": ["optional/file/paths.png"] }
  ],
  "style_tags": ["pixel-art", "dark-theme", etc]
}`

/** Build the vision prompt for a single asset. */
const buildPrompt = (entry: AssetEntry): string => {
  const template = entry.category === "layouts" ? LAYOUT_VISION_PROMPT_TEMPLATE : VISION_PROMPT_TEMPLATE

  return template
    .replace("{filename}", entry.file)
    .replace("{category}", entry.category)
    .replace("{width}", String(entry.width))
    .replace("{height}", String(entry.height))
    .replace("{hasAlpha}", String(entry.hasAlpha))
}

/** Invoke claude -p with an image file for vision description. */
const invokeVision = (
  imagePath: string,
  prompt: string,
  model: string,
  timeoutMs: number,
): VisionDescription | null => {
  try {
    const result = execFileSync("claude", [
      "-p",
      "--model", model,
      "--output-format", "json",
      prompt,
      "--file", imagePath,
    ], {
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })

    // claude -p --output-format json wraps the result
    const parsed = JSON.parse(result)
    const text = parsed.result ?? parsed
    return typeof text === "string" ? JSON.parse(text) : text
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`${warning(`Vision failed for ${imagePath}: ${msg}`, { stream: "stderr" })}\n`)
    return null
  }
}

/** Merge vision description fields into an existing asset entry. */
const mergeVision = (entry: AssetEntry, vision: VisionDescription): void => {
  if (vision.description) entry.description = vision.description
  if (vision.facing) entry.facing = vision.facing
  if (vision.pose) entry.pose = vision.pose
  if (vision.styleTags) entry.styleTags = vision.styleTags
  if (vision.animationType !== undefined) entry.animationType = vision.animationType
  if (vision.layoutRegions) entry.layoutRegions = vision.layoutRegions
  if (vision.isReferenceOnly) entry.isReferenceOnly = vision.isReferenceOnly

  // Vision can override spritesheet detection if it disagrees
  if (vision.isSpritesheet !== undefined && vision.isSpritesheet !== entry.isSpritesheet) {
    entry.isSpritesheet = vision.isSpritesheet
    if (vision.frameCount) entry.frameCount = vision.frameCount
    if (vision.frameDirection) {
      entry.frameDirection = vision.frameDirection as "horizontal" | "vertical"
    }
  }
}

/**
 * Run vision enrichment on the specified assets within a catalog.
 * Modifies the catalog entries in place.
 */
export const describeAssets = async (
  catalog: AssetCatalog,
  assetDir: string,
  filesToDescribe: string[],
  opts: VisionOptions,
): Promise<void> => {
  const fileSet = new Set(filesToDescribe)
  const entriesToDescribe = catalog.assets.filter((a) => fileSet.has(a.file))

  for (const entry of entriesToDescribe) {
    const absPath = path.join(assetDir, entry.file)
    if (!fs.existsSync(absPath)) continue

    const prompt = buildPrompt(entry)
    process.stderr.write(`${hint(`  Describing ${entry.file}...`, { stream: "stderr" })}\n`)

    const vision = invokeVision(absPath, prompt, opts.model, opts.timeoutMs)
    if (vision) {
      mergeVision(entry, vision)
    }
  }
}
