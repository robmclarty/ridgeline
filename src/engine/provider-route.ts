import { resolveEngineProviders } from "../stores/settings.js"

/**
 * Provider prefixes fascicle's `resolve_model` recognizes in a `provider:id`
 * colon-form model string. Mirrors fascicle's internal `KNOWN_PROVIDERS` so the
 * route prediction matches how the engine will actually dispatch the call. Keep
 * in sync with fascicle if it adds a transport.
 */
const KNOWN_PROVIDERS: ReadonlySet<string> = new Set([
  "anthropic",
  "openai",
  "google",
  "ollama",
  "lmstudio",
  "openrouter",
  "claude_cli",
])

export type ResolvedRoute = {
  /** The provider the engine will dispatch this model to. */
  readonly provider: string
  /** The model id with any known `provider:` prefix stripped. */
  readonly modelId: string
  /**
   * True only for the subscription/OAuth Claude CLI transport, which is
   * single-turn, ignores `max_steps`, and runs tools via the CLI's built-ins.
   * The spawn path (`runClaudeProcess`) stays bound to this; every other
   * provider — including the AI-SDK `anthropic` provider — drives the in-process
   * engine + tool loop. This is the single predicate core flows branch on.
   */
  readonly isClaudeCli: boolean
}

/**
 * Predict which provider a model string lands on, mirroring fascicle's
 * `resolve_model` precedence: a known `provider:id` colon-form prefix wins,
 * otherwise the engine's default provider applies (settings `provider`, else
 * `anthropic` when `ANTHROPIC_API_KEY` is set, else `claude_cli`). Matches
 * `makeRidgelineEngine`'s default-provider resolution so the predicate agrees
 * with the engine at dispatch time.
 */
export const resolveRoute = (model: string, ridgelineDir: string): ResolvedRoute => {
  const colon = model.indexOf(":")
  if (colon > 0) {
    const prefix = model.slice(0, colon)
    if (KNOWN_PROVIDERS.has(prefix)) {
      return {
        provider: prefix,
        modelId: model.slice(colon + 1),
        isClaudeCli: prefix === "claude_cli",
      }
    }
  }
  const provider =
    resolveEngineProviders(ridgelineDir).provider ??
    (process.env.ANTHROPIC_API_KEY ? "anthropic" : "claude_cli")
  return { provider, modelId: model, isClaudeCli: provider === "claude_cli" }
}

/**
 * True when `model` is a Claude model the Claude CLI can run (opus/sonnet/haiku,
 * a `claude-*` id, or an `anthropic:`/`claude_cli:` colon-form). The autonomous
 * builder keeps such models on the byte-stable subscription CLI regardless of
 * whether `ANTHROPIC_API_KEY` is set; only genuinely non-Claude models take the
 * in-process engine path. (Distinct from `resolveRoute().isClaudeCli`, which
 * routes a bare family to the API when a key is present.)
 */
export const isClaudeBuildModel = (model: string): boolean => {
  const colon = model.indexOf(":")
  const provider = colon > 0 ? model.slice(0, colon) : ""
  const id = colon > 0 ? model.slice(colon + 1) : model
  if (provider && provider !== "anthropic" && provider !== "claude_cli") return false
  return /^(opus|sonnet|haiku)$/i.test(id) || /^claude[-/]/i.test(id)
}

/** Providers fascicle treats as free (cost always $0), so an absent price is correct, not a gap. */
const FREE_ENGINE_PROVIDERS: ReadonlySet<string> = new Set(["ollama", "lmstudio"])

/**
 * Decide whether a budget cap is unenforceable for `model`: a non-Claude,
 * non-free provider whose price `resolvePrice` doesn't know reports $0, so
 * `--max-budget-usd` would never trip and the run is silently uncapped. Returns
 * the resolved `provider`/`modelId` to name in a warning, or `null` when the cap
 * is enforceable (no cap, a Claude model, a free provider, or a priced model).
 */
export const unpriceableBudgetTarget = (
  model: string,
  ridgelineDir: string,
  maxBudgetUsd: number | null,
  resolvePrice: (provider: string, modelId: string) => unknown,
): { provider: string; modelId: string } | null => {
  if (maxBudgetUsd == null) return null
  if (isClaudeBuildModel(model)) return null
  const { provider, modelId } = resolveRoute(model, ridgelineDir)
  if (provider === "claude_cli" || FREE_ENGINE_PROVIDERS.has(provider)) return null
  if (resolvePrice(provider, modelId) !== undefined) return null
  return { provider, modelId }
}
