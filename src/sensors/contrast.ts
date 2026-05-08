import * as fs from "node:fs"
import * as path from "node:path"
import { hex } from "wcag-contrast"
import type { ColorPair, SensorAdapter, SensorFinding, SensorInput } from "./index.js"

const WCAG_AA_NORMAL = 4.5
const HEX_TOKEN = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g
const HEX_VALIDATE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

const normalizeHex = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed.startsWith("#")) return `#${trimmed}`
  return trimmed
}

const isValidHex = (value: string): boolean => HEX_VALIDATE.test(value)

const extractPairsFromMarkdown = (content: string): ColorPair[] => {
  const pairs: ColorPair[] = []
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const tokens = line.match(HEX_TOKEN)
    if (!tokens || tokens.length < 2) continue
    const [bg, fg] = tokens
    pairs.push({ background: bg, foreground: fg })
  }
  return pairs
}

const discoverPairs = (input: SensorInput): ColorPair[] => {
  if (input.contrastPairs && input.contrastPairs.length > 0) {
    return [...input.contrastPairs]
  }
  const ridgelineDir = input.ridgelineDir ?? path.join(input.cwd, ".ridgeline")
  const designPath = path.join(ridgelineDir, "design.md")
  if (!fs.existsSync(designPath)) return []
  const content = fs.readFileSync(designPath, "utf-8")
  return extractPairsFromMarkdown(content)
}

const scorePair = (pair: ColorPair): SensorFinding => {
  const background = normalizeHex(pair.background)
  const foreground = normalizeHex(pair.foreground)
  if (!isValidHex(background) || !isValidHex(foreground)) {
    return {
      kind: "contrast",
      summary: `invalid hex pair ${foreground} / ${background}`,
      severity: "warning",
    }
  }
  let ratio: number
  try {
    ratio = hex(foreground, background)
  } catch {
    return {
      kind: "contrast",
      summary: `invalid hex pair ${foreground} / ${background}`,
      severity: "warning",
    }
  }
  const label = pair.name ? `${pair.name} (${foreground} on ${background})` : `${foreground} on ${background}`
  if (ratio < WCAG_AA_NORMAL) {
    return {
      kind: "contrast",
      summary: `${label}: contrast ${ratio.toFixed(2)}:1 below WCAG AA 4.5:1`,
      severity: "error",
    }
  }
  return {
    kind: "contrast",
    summary: `${label}: contrast ${ratio.toFixed(2)}:1 meets WCAG AA`,
    severity: "info",
  }
}

const contrastSensor: SensorAdapter = {
  name: "contrast",
  async run(input: SensorInput): Promise<SensorFinding[]> {
    const pairs = discoverPairs(input)
    if (pairs.length === 0) return []
    return pairs.map(scorePair)
  },
}

export default contrastSensor
