import * as crypto from "node:crypto"
import * as fs from "node:fs"

// Dynamic imports for native deps — only loaded when catalog command runs
let sharpModule: typeof import("sharp") | null = null
let colorThiefModule: typeof import("colorthief") | null = null

const loadSharp = async () => {
  if (!sharpModule) sharpModule = (await import("sharp")).default as any
  return sharpModule!
}

const loadColorThief = async () => {
  if (!colorThiefModule) colorThiefModule = (await import("colorthief")).default as any
  return colorThiefModule!
}

type ImageMetadata = {
  width: number
  height: number
  format: string
  hasAlpha: boolean
  channels: number
}

type PaletteResult = {
  dominantColour: string
  palette: string[]
}

type SpritesheetInfo = {
  isSpritesheet: boolean
  frameCount: number
  frameSize: { w: number; h: number } | null
  frameDirection: "horizontal" | "vertical" | null
}

/** Extract image dimensions, format, alpha, and channel info via sharp. */
export const extractImageMetadata = async (filepath: string): Promise<ImageMetadata> => {
  const sharp = await loadSharp()
  const meta = await (sharp as any)(filepath).metadata()
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? "unknown",
    hasAlpha: meta.hasAlpha ?? false,
    channels: meta.channels ?? 3,
  }
}

/** Extract dominant colour and 6-colour palette via colorthief. */
export const extractPalette = async (filepath: string): Promise<PaletteResult> => {
  const ColorThief = await loadColorThief()
  try {
    const dominant: [number, number, number] = await (ColorThief as any).getColor(filepath)
    const palette: [number, number, number][] = await (ColorThief as any).getPalette(filepath, 6)
    return {
      dominantColour: rgbToHex(dominant),
      palette: palette.map(rgbToHex),
    }
  } catch {
    // colorthief can fail on very small or single-colour images
    return { dominantColour: "#000000", palette: [] }
  }
}

/** Detect spritesheet from dimensions — one dimension is an exact multiple of the other. */
export const detectSpritesheet = (width: number, height: number): SpritesheetInfo => {
  if (width <= 0 || height <= 0 || width === height) {
    return { isSpritesheet: false, frameCount: 1, frameSize: null, frameDirection: null }
  }

  const isWideStrip = width > height && width % height === 0
  const isTallStrip = height > width && height % width === 0

  if (isWideStrip) {
    return {
      isSpritesheet: true,
      frameCount: width / height,
      frameSize: { w: height, h: height },
      frameDirection: "horizontal",
    }
  }

  if (isTallStrip) {
    return {
      isSpritesheet: true,
      frameCount: height / width,
      frameSize: { w: width, h: width },
      frameDirection: "vertical",
    }
  }

  return { isSpritesheet: false, frameCount: 1, frameSize: null, frameDirection: null }
}

/**
 * Detect tilability by comparing edge pixel strips.
 * If the top row matches the bottom row (and left col matches right col),
 * the image is likely tileable.
 */
export const detectTileable = async (filepath: string, width: number, height: number): Promise<boolean> => {
  if (width < 2 || height < 2) return false

  const sharp = await loadSharp()

  try {
    // Extract top and bottom edge strips (1px high)
    const topPixels = await (sharp as any)(filepath)
      .extract({ left: 0, top: 0, width, height: 1 })
      .raw()
      .toBuffer()

    const bottomPixels = await (sharp as any)(filepath)
      .extract({ left: 0, top: height - 1, width, height: 1 })
      .raw()
      .toBuffer()

    // Extract left and right edge strips (1px wide)
    const leftPixels = await (sharp as any)(filepath)
      .extract({ left: 0, top: 0, width: 1, height })
      .raw()
      .toBuffer()

    const rightPixels = await (sharp as any)(filepath)
      .extract({ left: width - 1, top: 0, width: 1, height })
      .raw()
      .toBuffer()

    const hSimilarity = bufferSimilarity(topPixels, bottomPixels)
    const vSimilarity = bufferSimilarity(leftPixels, rightPixels)

    // Threshold: edges must be >85% similar
    return hSimilarity > 0.85 && vSimilarity > 0.85
  } catch {
    return false
  }
}

/** Compute MD5 content hash for change detection (not security-sensitive). */
export const computeContentHash = (filepath: string): string => {
  const data = fs.readFileSync(filepath)
  return crypto.createHash("md5").update(data).digest("hex")
}

// --- Helpers ---

const rgbToHex = (rgb: [number, number, number]): string =>
  "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("")

/** Compare two raw pixel buffers and return similarity ratio (0..1). */
const bufferSimilarity = (a: Buffer, b: Buffer): number => {
  if (a.length !== b.length || a.length === 0) return 0
  let matching = 0
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) <= 16) matching++ // tolerance of 16/255
  }
  return matching / a.length
}
