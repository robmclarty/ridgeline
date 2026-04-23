export interface Rgb { r: number; g: number; b: number }

export const parseHexRgb = (hex: string): Rgb => {
  const raw = hex.replace(/^#/, "")
  const expanded = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw
  const num = parseInt(expanded, 16)
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff }
}

export const rgbaOf = (hex: string, alpha: number): string => {
  const { r, g, b } = parseHexRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
