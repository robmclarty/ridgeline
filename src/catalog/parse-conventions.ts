import * as path from "node:path"

type ConventionResult = {
  category: string
  name: string
  subject: string
  state: string | null
}

/**
 * Parse category, subject, and state from the filesystem path.
 *
 * "characters/knight-walk.png" →
 *   { category: "characters", name: "knight-walk", subject: "knight", state: "walk" }
 *
 * "export_003.png" (no subdirectory) →
 *   { category: "uncategorized", name: "export_003", subject: "export_003", state: null }
 */
export const parseConventions = (relativePath: string): ConventionResult => {
  const parts = relativePath.split(path.sep)
  const category = parts.length > 1 ? parts[parts.length - 2] : "uncategorized"
  const filename = path.basename(relativePath, path.extname(relativePath))
  const segments = filename.split("-")

  return {
    category,
    name: filename,
    subject: segments[0] || filename,
    state: segments.length > 1 ? segments.slice(1).join("-") : null,
  }
}

type CategoryDefaults = {
  zLayer: string
  anchor: string
}

const CATEGORY_DEFAULTS: Record<string, CategoryDefaults> = {
  // Image categories
  characters:  { zLayer: "entity",     anchor: "bottom-center" },
  tiles:       { zLayer: "ground",     anchor: "top-left" },
  items:       { zLayer: "entity",     anchor: "center" },
  ui:          { zLayer: "ui",         anchor: "center" },
  backgrounds: { zLayer: "background", anchor: "top-left" },
  effects:     { zLayer: "foreground", anchor: "center" },
  layouts:     { zLayer: "ui",         anchor: "top-left" },
  // Audio categories
  music:       { zLayer: "background", anchor: "center" },
  sfx:         { zLayer: "entity",     anchor: "center" },
  ambience:    { zLayer: "background", anchor: "center" },
  dialogue:    { zLayer: "entity",     anchor: "center" },
  // Video categories
  cinematics:  { zLayer: "foreground", anchor: "center" },
  // Text/data categories
  data:        { zLayer: "entity",     anchor: "center" },
  docs:        { zLayer: "entity",     anchor: "center" },
}

const DEFAULT_FALLBACK: CategoryDefaults = { zLayer: "entity", anchor: "center" }

/** Infer default z-layer and anchor from category name. */
export const inferDefaults = (category: string): CategoryDefaults =>
  CATEGORY_DEFAULTS[category] ?? DEFAULT_FALLBACK

/** Categories that always get vision descriptions regardless of --describe flag. */
export const AUTO_DESCRIBE_CATEGORIES = new Set(["layouts", "ui"])
