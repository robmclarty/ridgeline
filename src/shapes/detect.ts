import * as fs from "node:fs"
import * as path from "node:path"

type ShapeDefinition = {
  name: string
  keywords: string[]
  reviewerContext: string
}

function resolveShapesDir(): string | null {
  const __dirname = path.dirname(new URL(import.meta.url).pathname)
  const candidates = [
    path.join(__dirname),
    path.join(__dirname, "..", "shapes"),
    path.join(__dirname, "..", "..", "src", "shapes"),
  ]

  for (const candidate of candidates) {
    try {
      const entries = fs.readdirSync(candidate) as string[]
      const hasJson = entries.some(f => f.endsWith(".json"))
      if (hasJson) return candidate
    } catch {
      // directory doesn't exist or can't be read — try next
    }
  }

  return null
}

export function loadShapeDefinitions(): ShapeDefinition[] {
  const dir = resolveShapesDir()
  if (dir === null) return []

  const entries = fs.readdirSync(dir) as string[]
  const jsonFiles = entries.filter(f => f.endsWith(".json"))

  const definitions: ShapeDefinition[] = []

  for (const file of jsonFiles) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8") as string
      const parsed = JSON.parse(raw)
      if (
        typeof parsed.name === "string" &&
        Array.isArray(parsed.keywords)
      ) {
        definitions.push(parsed as ShapeDefinition)
      }
    } catch {
      // malformed JSON or unreadable file — skip
    }
  }

  return definitions
}

export function detectShapes(text: string, definitions: ShapeDefinition[]): ShapeDefinition[] {
  if (!text || definitions.length === 0) return []

  const lower = text.toLowerCase()

  return definitions.filter(def =>
    def.keywords.some(keyword => lower.includes(keyword.toLowerCase()))
  )
}
