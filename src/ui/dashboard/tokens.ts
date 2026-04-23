import { brightenForContrast, compositeAccentFill } from "../contrast"

export const PALETTE = {
  bg: "#0B0F14",
  panel: "#121821",
  border: "#1F2937",
  text: "#E5E7EB",
  textDim: "#9CA3AF",
  error: "#EF4444",
  success: "#10B981",
  warning: "#F59E0B",
  info: "#06B6D4",
} as const

export type AccentName = "error" | "success" | "warning" | "info"

const ACCENTS: AccentName[] = ["error", "success", "warning", "info"]

export interface ResolvedAccent {
  name: AccentName
  accent: string
  text: string
  fill: string
}

const computeAccent = (name: AccentName): ResolvedAccent => {
  const accent = PALETTE[name]
  const fill = compositeAccentFill(accent, PALETTE.bg)
  const text = brightenForContrast(accent, PALETTE.bg)
  return { name, accent, text, fill }
}

export const resolveAccents = (): ResolvedAccent[] => ACCENTS.map(computeAccent)
