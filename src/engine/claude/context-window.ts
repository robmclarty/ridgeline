import { loadSettings } from "../../stores/settings"

/**
 * Conservative per-model context-window defaults in tokens.
 *
 * Anthropic publishes per-model context windows; ridgeline ships conservative
 * 200K baselines and lets users raise the value (e.g. to 1,000,000 for the
 * 1M-context Sonnet variant) via `contextWindows` in settings.json.
 *
 * The context window is a HARD ceiling — exceeding it truncates output —
 * distinct from `phaseTokenLimit` (a user-configurable soft target).
 */
export const DEFAULT_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-7": 200_000,
  "claude-opus-4-6": 200_000,
  "claude-opus-4-5": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-sonnet-4-5": 200_000,
  "claude-haiku-4-5": 200_000,
  "cli-opus": 200_000,
  "cli-sonnet": 200_000,
  "cli-haiku": 200_000,
  opus: 200_000,
  sonnet: 200_000,
  haiku: 200_000,
}

export const FALLBACK_CONTEXT_WINDOW = 200_000

/**
 * Resolve the context window for a given model. Settings.json overrides
 * win, then built-in defaults, then the conservative fallback.
 */
export const resolveContextWindow = (model: string, ridgelineDir: string): number => {
  const overrides = loadSettings(ridgelineDir).contextWindows
  if (overrides && typeof overrides === "object") {
    const direct = overrides[model]
    if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) {
      return Math.floor(direct)
    }
  }
  if (model in DEFAULT_CONTEXT_WINDOWS) return DEFAULT_CONTEXT_WINDOWS[model]
  return FALLBACK_CONTEXT_WINDOW
}
