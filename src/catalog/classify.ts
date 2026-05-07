import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { MediaType } from "./types.js"
import { warning } from "../ui/color.js"

type ClassificationResult = {
  category: string
  confidence: "high" | "medium" | "low"
}

// --- Heuristic patterns (filename prefix → category) ---

const IMAGE_HEURISTICS: [RegExp, string][] = [
  [/^(bg|background|backdrop|sky|scenery)[_-]/i, "backgrounds"],
  [/^(btn|button|icon|hud|bar|frame|panel|menu)[_-]/i, "ui"],
  [/^(tile|floor|wall|ground|terrain|grass|stone|brick)[_-]/i, "tiles"],
  [/^(char|character|player|enemy|npc|hero|sprite)[_-]/i, "characters"],
  [/^(item|pickup|loot|potion|coin|gem|key|weapon|sword|shield)[_-]/i, "items"],
  [/^(fx|effect|particle|explosion|spark|flash|smoke)[_-]/i, "effects"],
  [/^(layout|mockup|wireframe|screen)[_-]/i, "layouts"],
]

const AUDIO_HEURISTICS: [RegExp, string][] = [
  [/^(bgm|music|soundtrack|theme|ost|track|song)[_-]/i, "music"],
  [/^(sfx|click|hit|boom|slash|jump|land|step|beep|ding|whoosh|pop|crash)[_-]/i, "sfx"],
  [/^(ambient|ambience|wind|rain|water|forest|cave|city|night|crowd)[_-]/i, "ambience"],
  [/^(voice|dialogue|narrat|speech|line)[_-]/i, "dialogue"],
]

const VIDEO_HEURISTICS: [RegExp, string][] = [
  [/^(cutscene|cinematic|intro|outro|ending|opening)[_-]/i, "cinematics"],
]

const TEXT_HEURISTICS: [RegExp, string][] = [
  [/^(dialogue|conversation|script|line|speech)[_-]/i, "dialogue"],
  [/^(doc|readme|guide|manual|help|note)[_-]/i, "docs"],
]

/** Categories valid for each media type. */
const CATEGORIES_BY_MEDIA: Record<MediaType, string[]> = {
  image: ["characters", "tiles", "items", "ui", "backgrounds", "effects", "layouts"],
  audio: ["music", "sfx", "ambience", "dialogue"],
  video: ["cinematics"],
  text: ["dialogue", "data", "docs"],
}

const HEURISTICS_BY_MEDIA: Record<MediaType, [RegExp, string][]> = {
  image: IMAGE_HEURISTICS,
  audio: AUDIO_HEURISTICS,
  video: VIDEO_HEURISTICS,
  text: TEXT_HEURISTICS,
}

/**
 * Attempt to classify a file using filename pattern matching.
 * Returns null if no heuristic matches confidently.
 */
export const classifyByHeuristics = (
  filename: string,
  ext: string,
  mediaType: MediaType,
): ClassificationResult | null => {
  const basename = path.basename(filename, ext)

  // Text data files by extension
  if (mediaType === "text" && [".json", ".csv", ".yaml", ".yml"].includes(ext)) {
    return { category: "data", confidence: "medium" }
  }

  const patterns = HEURISTICS_BY_MEDIA[mediaType]
  for (const [pattern, category] of patterns) {
    if (pattern.test(basename)) {
      return { category, confidence: "high" }
    }
  }

  return null
}

// --- AI classification prompts ---

const IMAGE_CLASSIFY_PROMPT = `You are classifying game assets into organized categories. Analyze this image and determine the best category.

File: {filename}

Available categories:
- characters: Player characters, NPCs, enemies, character sprites, portraits
- tiles: Ground tiles, wall tiles, terrain, tileable textures
- items: Inventory items, pickups, powerups, weapons, equipment
- ui: HUD elements, buttons, frames, health bars, menu components
- backgrounds: Scenery, parallax layers, sky, environment backdrops
- effects: Particles, explosions, magic effects, weather, visual FX
- layouts: UI mockups, screen layouts, wireframes
- uncategorized: Does not clearly fit any category above

Respond with ONLY valid JSON:
{
  "category": "one of the categories above",
  "confidence": "high" | "medium" | "low"
}`

const buildNonImagePrompt = (
  filename: string,
  ext: string,
  mediaType: MediaType,
  fileSizeBytes: number,
  contentPreview: string | null,
): string => {
  const categories = CATEGORIES_BY_MEDIA[mediaType]
  const categoryList = categories
    .map((c) => `- ${c}`)
    .join("\n")

  const preview = contentPreview
    ? `\nContent preview (first 500 chars):\n\`\`\`\n${contentPreview}\n\`\`\``
    : ""

  return `You are classifying game asset files into organized categories based on filename, extension, and file content.

File: ${filename}
Extension: ${ext}
Media type: ${mediaType}
File size: ${Math.round(fileSizeBytes / 1024)} KB${preview}

Available categories for ${mediaType}:
${categoryList}
- uncategorized: Does not clearly fit any category above

Respond with ONLY valid JSON:
{
  "category": "one of the categories above",
  "confidence": "high" | "medium" | "low"
}`
}

/** Invoke Claude and parse the classification result. */
const invokeClaude = (
  prompt: string,
  model: string,
  timeoutMs: number,
  filename: string,
  filePath?: string,
): ClassificationResult => {
  const args = ["-p", "--model", model, "--output-format", "json", prompt]
  if (filePath) args.push("--file", filePath)

  try {
    const result = execFileSync("claude", args, {
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })

    const parsed = JSON.parse(result)
    const text = parsed.result ?? parsed
    const data = typeof text === "string" ? JSON.parse(text) : text

    return {
      category: data.category ?? "uncategorized",
      confidence: data.confidence ?? "low",
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`${warning(`Classification failed for ${filename}: ${msg}`, { stream: "stderr" })}\n`)
    return { category: "uncategorized", confidence: "low" }
  }
}

/**
 * Classify a single file using AI.
 * Dispatches to vision (images) or text-only (audio/video/text).
 */
export const classifyWithAI = (
  absPath: string,
  filename: string,
  ext: string,
  mediaType: MediaType,
  model: string,
  timeoutMs: number,
): ClassificationResult => {
  if (mediaType === "image") {
    const prompt = IMAGE_CLASSIFY_PROMPT.replace("{filename}", filename)
    return invokeClaude(prompt, model, timeoutMs, filename, absPath)
  }

  const stat = fs.statSync(absPath)
  let contentPreview: string | null = null

  if (mediaType === "text") {
    try {
      const content = fs.readFileSync(absPath, "utf-8")
      contentPreview = content.slice(0, 500)
    } catch {
      // Binary or unreadable — skip preview
    }
  }

  const prompt = buildNonImagePrompt(filename, ext, mediaType, stat.size, contentPreview)
  return invokeClaude(prompt, model, timeoutMs, filename)
}
