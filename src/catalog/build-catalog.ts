import * as fs from "node:fs"
import * as path from "node:path"
import { AssetCatalog, AssetEntry, CatalogOptions, MediaType, VisualIdentity } from "./types.js"
import { parseConventions, inferDefaults, AUTO_DESCRIBE_CATEGORIES } from "./parse-conventions.js"
import {
  extractImageMetadata,
  extractPalette,
  detectSpritesheet,
  detectTileable,
  computeContentHash,
  extractBasicMetadata,
} from "./extract-metadata.js"
import { classifyByHeuristics, classifyWithAI } from "./classify.js"
import { hint } from "../ui/color.js"

/** Map file extensions to media types. */
const MEDIA_EXTENSIONS: Record<string, MediaType> = {
  // images
  ".png": "image", ".jpg": "image", ".jpeg": "image",
  ".gif": "image", ".webp": "image", ".svg": "image", ".avif": "image",
  // audio
  ".mp3": "audio", ".wav": "audio", ".ogg": "audio",
  ".flac": "audio", ".aac": "audio", ".m4a": "audio",
  // video
  ".mp4": "video", ".webm": "video", ".mov": "video", ".avi": "video",
  // text
  ".txt": "text", ".json": "text", ".csv": "text",
  ".md": "text", ".yaml": "text", ".yml": "text",
}

/** Detect media type from file extension. */
const detectMediaType = (filePath: string): MediaType | null =>
  MEDIA_EXTENSIONS[path.extname(filePath).toLowerCase()] ?? null

/** Recursively walk a directory tree and return all asset file paths (relative to root). */
const walkAssets = (dir: string, root?: string): string[] => {
  const base = root ?? dir
  const results: string[] = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkAssets(fullPath, base))
    } else if (detectMediaType(entry.name) !== null) {
      results.push(path.relative(base, fullPath))
    }
  }

  return results
}

/** Load existing catalog from disk, if present. */
const loadExistingCatalog = (catalogPath: string): AssetCatalog | null => {
  if (!fs.existsSync(catalogPath)) return null
  try {
    return JSON.parse(fs.readFileSync(catalogPath, "utf-8"))
  } catch {
    return null
  }
}

/** Build a lookup map from an existing catalog for incremental updates. */
const buildHashIndex = (catalog: AssetCatalog | null): Map<string, AssetEntry> => {
  const index = new Map<string, AssetEntry>()
  if (!catalog) return index
  for (const entry of catalog.assets) {
    index.set(entry.file, entry)
  }
  return index
}

/** Detect the most common resolution among square or nearly-square image assets. */
const detectResolution = (assets: AssetEntry[]): string | null => {
  const sizes = new Map<string, number>()
  for (const a of assets) {
    if (a.mediaType !== "image") continue
    if (a.isSpritesheet && a.frameSize) {
      const key = `${a.frameSize.w}x${a.frameSize.h}`
      sizes.set(key, (sizes.get(key) ?? 0) + 1)
    } else if (a.width && a.height && a.width === a.height && a.width <= 256) {
      const key = `${a.width}x${a.height}`
      sizes.set(key, (sizes.get(key) ?? 0) + 1)
    }
  }
  if (sizes.size === 0) return null
  return [...sizes.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

/** Build aggregate palette from all image assets (top 8 most frequent colours). */
const detectPalette = (assets: AssetEntry[]): string[] => {
  const freq = new Map<string, number>()
  for (const a of assets) {
    if (!a.palette) continue
    for (const c of a.palette) {
      freq.set(c, (freq.get(c) ?? 0) + 1)
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([colour]) => colour)
}

/** Detect visual style from image asset properties. */
const detectStyle = (assets: AssetEntry[]): string | null => {
  const imageAssets = assets.filter((a) => a.mediaType === "image")
  if (imageAssets.length === 0) return null

  const smallAssets = imageAssets.filter((a) => {
    const size = a.isSpritesheet && a.frameSize
      ? Math.max(a.frameSize.w, a.frameSize.h)
      : Math.max(a.width ?? 0, a.height ?? 0)
    return size <= 128
  })
  if (smallAssets.length > imageAssets.length * 0.6) return "pixel-art"

  const svgCount = imageAssets.filter((a) => a.format === "svg").length
  if (svgCount > imageAssets.length * 0.5) return "vector"

  return null
}

/** Derive aggregate visual identity from all cataloged assets. */
const deriveVisualIdentity = (assets: AssetEntry[]): VisualIdentity => {
  const style = detectStyle(assets)
  return {
    detectedStyle: style,
    detectedPalette: detectPalette(assets),
    detectedResolution: detectResolution(assets),
    detectedScaling: style === "pixel-art" ? "nearest" : null,
  }
}

/** Compare detected palette against design.md palette and produce warnings. */
const checkPaletteMismatches = (assets: AssetEntry[], buildDir: string, ridgelineDir: string): string[] => {
  const warnings: string[] = []

  const designPaths = [
    path.join(buildDir, "design.md"),
    path.join(ridgelineDir, "design.md"),
  ]

  let designContent: string | null = null
  for (const p of designPaths) {
    if (fs.existsSync(p)) {
      designContent = fs.readFileSync(p, "utf-8")
      break
    }
  }

  if (!designContent) return warnings

  const hexPattern = /#[0-9a-fA-F]{6}/g
  const designColours = new Set(
    [...designContent.matchAll(hexPattern)].map((m) => m[0].toLowerCase())
  )

  if (designColours.size === 0) return warnings

  for (const asset of assets) {
    if (!asset.palette) continue
    const offPalette = asset.palette.filter((c) => !designColours.has(c.toLowerCase()))
    if (offPalette.length > 0) {
      warnings.push(
        `${asset.file} uses colours (${offPalette.join(", ")}) not found in design.md palette. This may be intentional.`
      )
    }
  }

  return warnings
}

export type CatalogResult = {
  catalog: AssetCatalog
  stats: {
    total: number
    added: number
    updated: number
    unchanged: number
    pruned: number
    classified: number
  }
  /** Files in auto-describe categories that need vision enrichment. */
  needsVisionDescribe: string[]
}

type BuildCatalogOpts = Pick<CatalogOptions, "isForce" | "isClassify" | "model" | "timeout">

/**
 * Build or update the asset catalog.
 * Handles all media types. Vision enrichment and sprite packing are handled separately.
 */
export const buildCatalog = async (
  assetDir: string,
  buildDir: string,
  opts: BuildCatalogOpts,
): Promise<CatalogResult> => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const catalogPath = path.join(buildDir, "asset-catalog.json")
  const existing = loadExistingCatalog(catalogPath)
  const hashIndex = buildHashIndex(existing)

  const assetFiles = walkAssets(assetDir)
  const existingFiles = new Set(hashIndex.keys())

  const assets: AssetEntry[] = []
  const needsVisionDescribe: string[] = []
  let added = 0
  let updated = 0
  let unchanged = 0
  let classified = 0

  const timeoutMs = opts.timeout * 60 * 1000
  const totalFiles = assetFiles.length
  let processedCount = 0

  for (const relPath of assetFiles) {
    const absPath = path.join(assetDir, relPath)
    const hash = computeContentHash(absPath)
    const prev = hashIndex.get(relPath)
    existingFiles.delete(relPath)

    // Skip unchanged files (unless --force)
    if (!opts.isForce && prev && prev.hash === hash) {
      assets.push(prev)
      unchanged++

      // Still track if auto-describe category needs vision
      if (prev.mediaType === "image") {
        const conv = parseConventions(relPath)
        if (AUTO_DESCRIBE_CATEGORIES.has(conv.category) && !prev.description) {
          needsVisionDescribe.push(relPath)
        }
      }
      continue
    }

    processedCount++
    const mediaType = detectMediaType(relPath)!
    const conventions = parseConventions(relPath)
    const basic = extractBasicMetadata(absPath)

    // Build the entry — image-specific metadata only for images
    const entry: AssetEntry = {
      file: relPath,
      hash,
      mediaType,
      category: conventions.category,
      name: conventions.name,
      subject: conventions.subject,
      state: conventions.state,
      fileSizeBytes: basic.fileSizeBytes,
      extension: basic.extension,
    }

    if (mediaType === "image") {
      const meta = await extractImageMetadata(absPath)
      const palette = await extractPalette(absPath)
      const spritesheet = detectSpritesheet(meta.width, meta.height)
      const isTileable = await detectTileable(absPath, meta.width, meta.height)
      const defaults = inferDefaults(conventions.category)

      entry.width = meta.width
      entry.height = meta.height
      entry.format = meta.format
      entry.hasAlpha = meta.hasAlpha
      entry.channels = meta.channels
      entry.dominantColour = palette.dominantColour
      entry.palette = palette.palette
      entry.isSpritesheet = spritesheet.isSpritesheet
      entry.frameCount = spritesheet.frameCount
      entry.frameSize = spritesheet.frameSize
      entry.frameDirection = spritesheet.frameDirection
      entry.suggestedAnchor = defaults.anchor
      entry.suggestedZLayer = defaults.zLayer
      entry.isTileable = isTileable
    }

    // Classify uncategorized files when --classify is set
    if (conventions.category === "uncategorized" && opts.isClassify) {
      process.stderr.write(`${hint(`  Classifying ${relPath} (${processedCount}/${totalFiles})...`, { stream: "stderr" })}\n`)

      const result = classifyByHeuristics(relPath, basic.extension, mediaType)
        ?? classifyWithAI(absPath, relPath, basic.extension, mediaType, opts.model, timeoutMs)

      entry.category = result.category
      entry.isClassified = true
      entry.classificationConfidence = result.confidence
      classified++

      // Update anchor/zLayer defaults based on new category
      if (mediaType === "image") {
        const defaults = inferDefaults(entry.category)
        entry.suggestedAnchor = defaults.anchor
        entry.suggestedZLayer = defaults.zLayer
      }
    }

    assets.push(entry)

    if (mediaType === "image" && AUTO_DESCRIBE_CATEGORIES.has(entry.category)) {
      needsVisionDescribe.push(relPath)
    }

    if (prev) {
      updated++
    } else {
      added++
    }
  }

  // Remaining entries in existingFiles are pruned (files removed from disk)
  const pruned = existingFiles.size

  const catalog: AssetCatalog = {
    generatedAt: new Date().toISOString(),
    assetDir,
    isDescribed: existing?.isDescribed ?? false,
    visualIdentity: deriveVisualIdentity(assets),
    warnings: checkPaletteMismatches(assets, buildDir, ridgelineDir),
    assets,
  }

  return {
    catalog,
    stats: { total: assets.length, added, updated, unchanged, pruned, classified },
    needsVisionDescribe,
  }
}
