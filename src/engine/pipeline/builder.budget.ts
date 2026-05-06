import { approximateTokenCount } from "../claude/stable.prompt"
import { resolveContextWindow } from "../claude/context-window"
import type { RidgelineConfig } from "../../types"

/** Reserved headroom inside the context window for output framing + buffer. */
export const SAFETY_MARGIN_TOKENS = 5_000

/** Default fraction of the per-call output budget below which the builder should keep working. */
export const DEFAULT_SOFT_LIMIT_FRACTION = 0.7
/** Default fraction of the per-call output budget where the builder MUST wind down. */
export const DEFAULT_HARD_LIMIT_FRACTION = 0.85

export interface BuilderBudget {
  /** The model's full context window (input + output). Hard ceiling. */
  contextWindow: number
  /** Estimated input tokens for this invocation (system + user prompt). */
  inputTokensEstimate: number
  /**
   * Maximum tokens this invocation can output before risking truncation.
   *
   *   contextWindow - inputTokensEstimate - SAFETY_MARGIN_TOKENS
   */
  outputBudget: number
  /**
   * Soft target shown to the builder. The builder should aim to land natural
   * breakpoints around this number and emit `MORE_WORK_NEEDED` when reached.
   *
   *   min(phaseTokenLimit, outputBudget × softFraction)
   *
   * `phaseTokenLimit` caps but never raises this value. When the user
   * disables `phaseTokenLimit`, the soft target is purely context-driven.
   */
  softLimit: number
  /**
   * Hard target shown to the builder. The builder must STOP at or before
   * this number to avoid truncation:
   *
   *   outputBudget × hardFraction
   */
  hardLimit: number
}

interface BudgetOptions {
  softFraction?: number
  hardFraction?: number
}

/**
 * Compute the per-invocation token budget for a builder call. The orchestrator
 * passes `softLimit` / `hardLimit` to the builder via the user prompt; after the
 * call returns, the loop compares measured output tokens against these to
 * detect implicit wind-down (e.g. timeouts, missing markers).
 */
export const computeBuilderBudget = (
  systemPrompt: string,
  userPrompt: string,
  config: RidgelineConfig,
  opts: BudgetOptions = {},
): BuilderBudget => {
  const softFraction = clampFraction(opts.softFraction, DEFAULT_SOFT_LIMIT_FRACTION)
  const hardFraction = clampFraction(opts.hardFraction, DEFAULT_HARD_LIMIT_FRACTION)

  const contextWindow = resolveContextWindow(config.model, config.ridgelineDir)
  const inputTokensEstimate = approximateTokenCount(systemPrompt) + approximateTokenCount(userPrompt)
  const rawOutputBudget = contextWindow - inputTokensEstimate - SAFETY_MARGIN_TOKENS
  const outputBudget = Math.max(rawOutputBudget, 0)

  const contextSoftCap = Math.floor(outputBudget * softFraction)
  const phaseCap = config.phaseTokenLimit
  const softLimit = phaseCap > 0 ? Math.min(phaseCap, contextSoftCap) : contextSoftCap
  const hardLimit = Math.floor(outputBudget * hardFraction)

  return { contextWindow, inputTokensEstimate, outputBudget, softLimit, hardLimit }
}

const clampFraction = (raw: number | undefined, fallback: number): number => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback
  if (raw <= 0 || raw > 1) return fallback
  return raw
}
