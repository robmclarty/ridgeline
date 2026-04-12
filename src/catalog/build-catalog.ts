import * as fs from "node:fs"
import * as path from "node:path"
import { AssetCatalog, AssetEntry, CatalogOptions, VisualIdentity } from "./types"
import { parseConventions, inferDefaults, AUTO_DESCRIBE_CATEGORIES } from "./parse-conventions"
import {
  extractImageMetadata,
  extractPalette,
  detectSpritesheet,
  detectTileable,
  computeContentHash,
} from "./extract-metadata"

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"])

/** Recursively walk a directory tree and return all image file paths (relative to root). */
const walkImages = (dir: string, root?: string): string[] => {
  const base = root ?? dir
  const results: string[] = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkImages(fullPath, base))
    } else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
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

/** Detect the most common resolution among square or nearly-square assets. */
const detectResolution = (assets: AssetEntry[]): string | null => {
  const sizes = new Map<string, number>()
  for (const a of assets) {
    if (a.isSpritesheet && a.frameSize) {
      const key = `${a.frameSize.w}x${a.frameSize.h}`
      sizes.set(key, (sizes.get(key) ?? 0) + 1)
    } else if (a.width === a.height && a.width <= 256) {
      const key = `${a.width}x${a.height}`
      sizes.set(key, (sizes.get(key) ?? 0) + 1)
    }
  }
  if (sizes.size === 0) return null
  return [...sizes.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

/** Build aggregate palette from all assets (top 8 most frequent colours). */
const detectPalette = (assets: AssetEntry[]): string[] => {
  const freq = new Map<string, number>()
  for (const a of assets) {
    for (const c of a.palette) {
      freq.set(c, (freq.get(c) ?? 0) + 1)
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([colour]) => colour)
}

/** Detect visual style from asset properties. */
const detectStyle = (assets: AssetEntry[]): string | null => {
  // If most assets are small and have few colours, likely pixel art
  const smallAssets = assets.filter((a) => {
    const size = a.isSpritesheet && a.frameSize
      ? Math.max(a.frameSize.w, a.frameSize.h)
      : Math.max(a.width, a.height)
    return size <= 128
  })
  if (smallAssets.length > assets.length * 0.6) return "pixel-art"

  // Check for SVG format dominance
  const svgCount = assets.filter((a) => a.format === "svg").length
  if (svgCount > assets.length * 0.5) return "vector"

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

  // Try to read design.md for palette comparison
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

  // Extract hex colours from design.md
  const hexPattern = /#[0-9a-fA-F]{6}/g
  const designColours = new Set(
    [...designContent.matchAll(hexPattern)].map((m) => m[0].toLowerCase())
  )

  if (designColours.size === 0) return warnings

  // Check each asset's palette for colours not in design.md
  for (const asset of assets) {
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
  }
  /** Files in auto-describe categories that need vision enrichment. */
  needsVisionDescribe: string[]
}

/**
 * Build or update the asset catalog (Tier 1 — deterministic only).
 * Vision enrichment and sprite packing are handled separately.
 */
export const buildCatalog = async (
  assetDir: string,
  buildDir: string,
  opts: Pick<CatalogOptions, "isForce">,
): Promise<CatalogResult> => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const catalogPath = path.join(buildDir, "asset-catalog.json")
  const existing = loadExistingCatalog(catalogPath)
  const hashIndex = buildHashIndex(existing)

  const imageFiles = walkImages(assetDir)
  const existingFiles = new Set(hashIndex.keys())

  const assets: AssetEntry[] = []
  const needsVisionDescribe: string[] = []
  let added = 0
  let updated = 0
  let unchanged = 0

  for (const relPath of imageFiles) {
    const absPath = path.join(assetDir, relPath)
    const hash = computeContentHash(absPath)
    const prev = hashIndex.get(relPath)
    existingFiles.delete(relPath)

    // Skip unchanged files (unless --force)
    if (!opts.isForce && prev && prev.hash === hash) {
      assets.push(prev)
      unchanged++

      // Still track if auto-describe category needs vision
      const conv = parseConventions(relPath)
      if (AUTO_DESCRIBE_CATEGORIES.has(conv.category) && !prev.description) {
        needsVisionDescribe.push(relPath)
      }
      continue
    }

    // Process new or changed file
    const conventions = parseConventions(relPath)
    const meta = await extractImageMetadata(absPath)
    const palette = await extractPalette(absPath)
    const spritesheet = detectSpritesheet(meta.width, meta.height)
    const isTileable = await detectTileable(absPath, meta.width, meta.height)
    const defaults = inferDefaults(conventions.category)

    const entry: AssetEntry = {
      file: relPath,
      hash,
      category: conventions.category,
      name: conventions.name,
      subject: conventions.subject,
      state: conventions.state,
      width: meta.width,
      height: meta.height,
      format: meta.format,
      hasAlpha: meta.hasAlpha,
      channels: meta.channels,
      dominantColour: palette.dominantColour,
      palette: palette.palette,
      isSpritesheet: spritesheet.isSpritesheet,
      frameCount: spritesheet.frameCount,
      frameSize: spritesheet.frameSize,
      frameDirection: spritesheet.frameDirection,
      suggestedAnchor: defaults.anchor,
      suggestedZLayer: defaults.zLayer,
      isTileable,
    }

    assets.push(entry)

    if (AUTO_DESCRIBE_CATEGORIES.has(conventions.category)) {
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
    stats: { total: assets.length, added, updated, unchanged, pruned },
    needsVisionDescribe,
  }
}
