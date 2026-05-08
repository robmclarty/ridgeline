import * as fs from "node:fs"
import * as path from "node:path"
import sharp from "sharp"
import { MaxRectsPacker } from "maxrects-packer"
import { AssetCatalog } from "./types.js"
import { hint, warning } from "../ui/color.js"

const ATLAS_SIZE = 2048
const PADDING = 1

interface SpriteInput {
  name: string
  sourceWidth: number
  sourceHeight: number
  trim: { x: number; y: number; w: number; h: number }
  buffer: Buffer
}

const loadSprite = async (assetDir: string, file: string): Promise<SpriteInput | null> => {
  const absPath = path.join(assetDir, file)
  if (!fs.existsSync(absPath)) return null

  const image = sharp(absPath).ensureAlpha()
  const meta = await image.metadata()
  const sourceWidth = meta.width ?? 0
  const sourceHeight = meta.height ?? 0
  if (sourceWidth === 0 || sourceHeight === 0) return null

  const trimmed = await image.clone().trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer({ resolveWithObject: true })
  const offsetLeft = -(trimmed.info.trimOffsetLeft ?? 0)
  const offsetTop = -(trimmed.info.trimOffsetTop ?? 0)

  return {
    name: path.basename(file, path.extname(file)),
    sourceWidth,
    sourceHeight,
    trim: {
      x: offsetLeft,
      y: offsetTop,
      w: trimmed.info.width,
      h: trimmed.info.height,
    },
    buffer: trimmed.data,
  }
}

const packCategory = async (
  outputDir: string,
  category: string,
  sprites: SpriteInput[],
): Promise<void> => {
  const packer = new MaxRectsPacker(ATLAS_SIZE, ATLAS_SIZE, PADDING, {
    smart: true,
    pot: false,
    square: false,
    allowRotation: false,
  })
  for (const sprite of sprites) {
    packer.add(sprite.trim.w, sprite.trim.h, sprite)
  }

  for (let binIndex = 0; binIndex < packer.bins.length; binIndex++) {
    const bin = packer.bins[binIndex]
    const suffix = packer.bins.length > 1 ? `-${binIndex}` : ""

    const composites = bin.rects.map((rect) => ({
      input: (rect.data as SpriteInput).buffer,
      left: rect.x,
      top: rect.y,
    }))

    const png = await sharp({
      create: { width: bin.width, height: bin.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite(composites)
      .png()
      .toBuffer()

    const imageName = `${category}${suffix}.png`
    fs.writeFileSync(path.join(outputDir, imageName), png)

    const frames: Record<string, unknown> = {}
    for (const rect of bin.rects) {
      const sprite = rect.data as SpriteInput
      frames[sprite.name] = {
        frame: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        rotated: false,
        trimmed: sprite.trim.w !== sprite.sourceWidth || sprite.trim.h !== sprite.sourceHeight,
        spriteSourceSize: sprite.trim,
        sourceSize: { w: sprite.sourceWidth, h: sprite.sourceHeight },
        pivot: { x: 0.5, y: 0.5 },
      }
    }

    const atlas = {
      frames,
      meta: {
        app: "ridgeline",
        version: "1.0",
        image: imageName,
        format: "RGBA8888",
        size: { w: bin.width, h: bin.height },
        scale: "1",
      },
    }
    fs.writeFileSync(path.join(outputDir, `${category}${suffix}.json`), JSON.stringify(atlas, null, 2))
  }
}

/**
 * Pack sprites into texture atlases grouped by category.
 * Produces PixiJS-compatible JSON + PNG atlas files.
 *
 * Output: <assetDir>/packed/<category>.png + <category>.json
 */
export const packAtlases = async (assetDir: string, catalog: AssetCatalog): Promise<void> => {
  const outputDir = path.join(assetDir, "packed")
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const byCategory = new Map<string, string[]>()
  for (const asset of catalog.assets) {
    if (asset.isReferenceOnly || asset.category === "layouts") continue
    if (asset.category === "backgrounds") continue

    const list = byCategory.get(asset.category) ?? []
    list.push(asset.file)
    byCategory.set(asset.category, list)
  }

  for (const [category, files] of byCategory) {
    if (files.length === 0) continue

    try {
      const sprites = (await Promise.all(files.map((f) => loadSprite(assetDir, f)))).filter(
        (s): s is SpriteInput => s !== null,
      )
      if (sprites.length === 0) continue

      await packCategory(outputDir, category, sprites)
      process.stderr.write(`${hint(`  Packed ${category}: ${sprites.length} sprites`, { stream: "stderr" })}\n`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`${warning(`Failed to pack ${category}: ${msg}`, { stream: "stderr" })}\n`)
    }
  }
}
