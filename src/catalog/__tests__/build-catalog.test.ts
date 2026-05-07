import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import sharp from "sharp"
import { makeTempDir } from "../../../test/setup.js"
import { buildCatalog } from "../build-catalog.js"

const defaultOpts = { isForce: false, isClassify: false, model: "", timeout: 5 } as const

let tmpDir: string
let assetDir: string
let buildDir: string

/** Create a tiny PNG test image. */
const createTestImage = async (
  dir: string,
  filename: string,
  width: number,
  height: number,
  colour: { r: number; g: number; b: number } = { r: 255, g: 0, b: 0 },
): Promise<string> => {
  const fullDir = path.dirname(path.join(dir, filename))
  fs.mkdirSync(fullDir, { recursive: true })

  const filePath = path.join(dir, filename)
  await sharp({
    create: { width, height, channels: 4, background: { ...colour, alpha: 255 } },
  })
    .png()
    .toFile(filePath)

  return filePath
}

beforeEach(() => {
  tmpDir = makeTempDir()
  assetDir = path.join(tmpDir, "assets")
  buildDir = path.join(tmpDir, "build")
  fs.mkdirSync(assetDir, { recursive: true })
  fs.mkdirSync(buildDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("buildCatalog", () => {
  it("catalogs a single image with correct metadata", async () => {
    await createTestImage(assetDir, "characters/hero-idle.png", 32, 32)

    const result = await buildCatalog(assetDir, buildDir, defaultOpts)

    expect(result.stats.total).toBe(1)
    expect(result.stats.added).toBe(1)

    const entry = result.catalog.assets[0]
    expect(entry.file).toBe("characters/hero-idle.png")
    expect(entry.category).toBe("characters")
    expect(entry.name).toBe("hero-idle")
    expect(entry.subject).toBe("hero")
    expect(entry.state).toBe("idle")
    expect(entry.width).toBe(32)
    expect(entry.height).toBe(32)
    expect(entry.format).toBe("png")
    expect(entry.hasAlpha).toBe(true)
    expect(entry.suggestedAnchor).toBe("bottom-center")
    expect(entry.suggestedZLayer).toBe("entity")
    expect(entry.isSpritesheet).toBe(false)
    expect(entry.hash).toMatch(/^[a-f0-9]{32}$/)
  })

  it("detects horizontal spritesheet", async () => {
    await createTestImage(assetDir, "characters/hero-walk.png", 128, 32)

    const result = await buildCatalog(assetDir, buildDir, defaultOpts)
    const entry = result.catalog.assets[0]

    expect(entry.isSpritesheet).toBe(true)
    expect(entry.frameCount).toBe(4)
    expect(entry.frameSize).toEqual({ w: 32, h: 32 })
    expect(entry.frameDirection).toBe("horizontal")
  })

  it("handles multiple categories", async () => {
    await createTestImage(assetDir, "characters/hero-idle.png", 32, 32)
    await createTestImage(assetDir, "tiles/ground-stone.png", 16, 16, { r: 128, g: 128, b: 128 })
    await createTestImage(assetDir, "backgrounds/sky.png", 640, 480, { r: 100, g: 150, b: 255 })

    const result = await buildCatalog(assetDir, buildDir, defaultOpts)

    expect(result.stats.total).toBe(3)
    expect(result.stats.added).toBe(3)

    const categories = result.catalog.assets.map((a) => a.category).sort()
    expect(categories).toEqual(["backgrounds", "characters", "tiles"])

    // Background should have different defaults
    const bg = result.catalog.assets.find((a) => a.category === "backgrounds")!
    expect(bg.suggestedZLayer).toBe("background")
    expect(bg.suggestedAnchor).toBe("top-left")
  })

  it("skips unchanged files on incremental run", async () => {
    await createTestImage(assetDir, "characters/hero-idle.png", 32, 32)

    // First run
    const first = await buildCatalog(assetDir, buildDir, defaultOpts)
    expect(first.stats.added).toBe(1)

    // Write catalog to disk (simulate persistence)
    const catalogPath = path.join(buildDir, "asset-catalog.json")
    fs.writeFileSync(catalogPath, JSON.stringify(first.catalog, null, 2))

    // Second run — same files
    const second = await buildCatalog(assetDir, buildDir, defaultOpts)
    expect(second.stats.unchanged).toBe(1)
    expect(second.stats.added).toBe(0)
  })

  it("re-processes changed files", async () => {
    await createTestImage(assetDir, "characters/hero-idle.png", 32, 32)
    const first = await buildCatalog(assetDir, buildDir, defaultOpts)
    fs.writeFileSync(
      path.join(buildDir, "asset-catalog.json"),
      JSON.stringify(first.catalog, null, 2),
    )

    // Modify the image
    await createTestImage(assetDir, "characters/hero-idle.png", 64, 64, { r: 0, g: 255, b: 0 })

    const second = await buildCatalog(assetDir, buildDir, defaultOpts)
    expect(second.stats.updated).toBe(1)
    expect(second.catalog.assets[0].width).toBe(64)
  })

  it("prunes entries for deleted files", async () => {
    await createTestImage(assetDir, "characters/hero-idle.png", 32, 32)
    await createTestImage(assetDir, "characters/hero-walk.png", 128, 32)

    const first = await buildCatalog(assetDir, buildDir, defaultOpts)
    fs.writeFileSync(
      path.join(buildDir, "asset-catalog.json"),
      JSON.stringify(first.catalog, null, 2),
    )
    expect(first.stats.total).toBe(2)

    // Delete one file
    fs.unlinkSync(path.join(assetDir, "characters/hero-walk.png"))

    const second = await buildCatalog(assetDir, buildDir, defaultOpts)
    expect(second.stats.total).toBe(1)
    expect(second.stats.pruned).toBe(1)
  })

  it("re-processes all files with --force", async () => {
    await createTestImage(assetDir, "characters/hero-idle.png", 32, 32)

    const first = await buildCatalog(assetDir, buildDir, defaultOpts)
    fs.writeFileSync(
      path.join(buildDir, "asset-catalog.json"),
      JSON.stringify(first.catalog, null, 2),
    )

    const forced = await buildCatalog(assetDir, buildDir, { ...defaultOpts, isForce: true })
    // File existed in prior catalog, so it counts as updated (not added) even with --force
    expect(forced.stats.updated).toBe(1)
    expect(forced.stats.unchanged).toBe(0)
  })

  it("flags ui assets for auto-describe", async () => {
    await createTestImage(assetDir, "ui/button-primary.png", 64, 32)

    const result = await buildCatalog(assetDir, buildDir, defaultOpts)
    expect(result.needsVisionDescribe).toContain("ui/button-primary.png")
  })

  it("derives visual identity from assets", async () => {
    // Create several small pixel-art-sized assets
    for (let i = 0; i < 4; i++) {
      await createTestImage(assetDir, `characters/char${i}-idle.png`, 32, 32)
    }

    const result = await buildCatalog(assetDir, buildDir, defaultOpts)
    expect(result.catalog.visualIdentity.detectedStyle).toBe("pixel-art")
    expect(result.catalog.visualIdentity.detectedResolution).toBe("32x32")
    expect(result.catalog.visualIdentity.detectedScaling).toBe("nearest")
  })
})
