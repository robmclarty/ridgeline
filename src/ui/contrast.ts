import { hex as contrastHex } from "wcag-contrast"
import { parseHexRgb, Rgb } from "./dashboard/hex"

const TEXT_FALLBACK = "#E5E7EB"
const MAX_L_PERCENT = 98
const STEP_PERCENT = 2
const DEFAULT_TARGET = 4.5
const ACCENT_FILL_ALPHA = 0.1

type Hsl = { h: number; s: number; l: number }


const toHex = (rgb: Rgb): string => {
  const part = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`.toUpperCase()
}

const compositeOver = (fg: Rgb, bg: Rgb, alpha: number): Rgb => ({
  r: fg.r * alpha + bg.r * (1 - alpha),
  g: fg.g * alpha + bg.g * (1 - alpha),
  b: fg.b * alpha + bg.b * (1 - alpha),
})

const rgbToHsl = (rgb: Rgb): Hsl => {
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l * 100 }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case r: h = ((g - b) / d) + (g < b ? 6 : 0); break
    case g: h = ((b - r) / d) + 2; break
    default: h = ((r - g) / d) + 4
  }
  return { h: h * 60, s: s * 100, l: l * 100 }
}

const hueToRgb = (p: number, q: number, t: number): number => {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

const hslToRgb = (hsl: Hsl): Rgb => {
  const h = hsl.h / 360
  const s = hsl.s / 100
  const l = hsl.l / 100
  if (s === 0) {
    const v = l * 255
    return { r: v, g: v, b: v }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: hueToRgb(p, q, h + 1 / 3) * 255,
    g: hueToRgb(p, q, h) * 255,
    b: hueToRgb(p, q, h - 1 / 3) * 255,
  }
}

export const brightenForContrast = (
  accentHex: string,
  bgHex: string,
  targetRatio: number = DEFAULT_TARGET,
): string => {
  const accentRgb = parseHexRgb(accentHex)
  const bgRgb = parseHexRgb(bgHex)
  const effectiveFill = toHex(compositeOver(accentRgb, bgRgb, ACCENT_FILL_ALPHA))

  if (contrastHex(accentHex, effectiveFill) >= targetRatio) {
    return accentHex.toUpperCase()
  }

  const hsl = rgbToHsl(accentRgb)
  for (let l = hsl.l + STEP_PERCENT; l <= MAX_L_PERCENT; l += STEP_PERCENT) {
    const candidate = toHex(hslToRgb({ h: hsl.h, s: hsl.s, l }))
    if (contrastHex(candidate, effectiveFill) >= targetRatio) return candidate
  }

  return TEXT_FALLBACK
}

export const compositeAccentFill = (accentHex: string, bgHex: string): string => {
  const accentRgb = parseHexRgb(accentHex)
  const bgRgb = parseHexRgb(bgHex)
  return toHex(compositeOver(accentRgb, bgRgb, ACCENT_FILL_ALPHA))
}
