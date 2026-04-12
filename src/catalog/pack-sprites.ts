import * as fs from "node:fs"
import * as path from "node:path"
import { AssetCatalog } from "./types"
import type { PackerExporterType } from "free-tex-packer-core"

/**
 * Pack sprites into texture atlases grouped by category.
 * Uses free-tex-packer-core to produce PixiJS-compatible JSON + PNG atlas files.
 *
 * Output: <assetDir>/packed/<category>.png + <category>.json
 */
export const packAtlases = async (assetDir: string, catalog: AssetCatalog): Promise<void> => {
  // Dynamic import — only loaded when --pack is used
  const { packAsync } = await import("free-tex-packer-core")

  const outputDir = path.join(assetDir, "packed")
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // Group assets by category (skip layouts — they're reference-only)
  const byCategory = new Map<string, string[]>()
  for (const asset of catalog.assets) {
    if (asset.isReferenceOnly || asset.category === "layouts") continue
    // Skip backgrounds — typically too large for atlases
    if (asset.category === "backgrounds") continue

    const list = byCategory.get(asset.category) ?? []
    list.push(asset.file)
    byCategory.set(asset.category, list)
  }

  for (const [category, files] of byCategory) {
    if (files.length === 0) continue

    const images = files
      .map((f) => {
        const absPath = path.join(assetDir, f)
        if (!fs.existsSync(absPath)) return null
        return {
          path: path.basename(f, path.extname(f)),
          contents: fs.readFileSync(absPath),
        }
      })
      .filter(Boolean) as { path: string; contents: Buffer }[]

    if (images.length === 0) continue

    try {
      const result = await packAsync(images, {
        textureName: category,
        width: 2048,
        height: 2048,
        fixedSize: false,
        padding: 1,
        allowRotation: false,
        detectIdentical: true,
        allowTrim: true,
        exporter: "Pixi" as PackerExporterType,
        removeFileExtension: true,
      })

      for (const file of result) {
        const outPath = path.join(outputDir, file.name)
        fs.writeFileSync(outPath, file.buffer)
      }

      process.stderr.write(`\x1b[90m  Packed ${category}: ${images.length} sprites\x1b[0m\n`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`\x1b[33mFailed to pack ${category}: ${msg}\x1b[0m\n`)
    }
  }
}
