import * as fs from "node:fs"
import * as path from "node:path"

type FlavourConfig = {
  recommendedSkills: string[]
}

const EMPTY_CONFIG: FlavourConfig = { recommendedSkills: [] }

/**
 * Load optional flavour.json config from a flavour directory.
 * Returns empty config if no file exists or it's malformed.
 */
export const loadFlavourConfig = (flavourDir: string | null): FlavourConfig => {
  if (!flavourDir) return EMPTY_CONFIG

  const configPath = path.join(flavourDir, "flavour.json")
  if (!fs.existsSync(configPath)) return EMPTY_CONFIG

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    return {
      recommendedSkills: Array.isArray(raw.recommendedSkills) ? raw.recommendedSkills : [],
    }
  } catch {
    return EMPTY_CONFIG
  }
}
