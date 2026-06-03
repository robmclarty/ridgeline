// `--timeout <minutes>` maps onto two distinct fascicle timeouts: stall (per-call), startup (constant 120s).
import { create_engine, type Engine, type EngineConfig, type ProviderConfigMap } from "fascicle"
import {
  buildSandboxPolicy,
  DEFAULT_NETWORK_ALLOWLIST_SEMI_LOCKED,
  DEFAULT_NETWORK_ALLOWLIST_STRICT,
  type SandboxFlag,
  type SandboxProviderConfig,
} from "./claude/sandbox.policy.js"

const STARTUP_TIMEOUT_MS = 120_000
const DEFAULT_STALL_TIMEOUT_MS = 300_000

export type RidgelineEngineConfig = {
  readonly sandboxFlag: SandboxFlag
  readonly timeoutMinutes?: number
  readonly pluginDirs: readonly string[]
  readonly settingSources: readonly ("user" | "project" | "local")[]
  readonly buildPath: string
  readonly networkAllowlistOverrides?: readonly string[]
  readonly additionalWritePaths?: readonly string[]
  /**
   * Default provider for engine-backed model calls. When omitted, the factory
   * routes to `anthropic` if ANTHROPIC_API_KEY is set, else `claude_cli`.
   * Setting this explicitly (e.g. from settings.json) is what keeps bare
   * families like `opus` resolvable once more than one provider is active.
   */
  readonly provider?: string
  /**
   * Extra providers to activate (e.g. ollama/lmstudio base_url, or overrides
   * for the env-activated API providers). `claude_cli` is reserved by ridgeline
   * and cannot be overridden here.
   */
  readonly providers?: ProviderConfigMap
}

const resolveSandbox = (cfg: RidgelineEngineConfig): SandboxProviderConfig | undefined => {
  const policy = buildSandboxPolicy({ sandboxFlag: cfg.sandboxFlag, buildPath: cfg.buildPath })
  if (!policy) return undefined

  const baseAllowlist = cfg.sandboxFlag === "strict"
    ? DEFAULT_NETWORK_ALLOWLIST_STRICT
    : DEFAULT_NETWORK_ALLOWLIST_SEMI_LOCKED

  const network_allowlist = cfg.networkAllowlistOverrides
    ? [...baseAllowlist, ...cfg.networkAllowlistOverrides]
    : policy.network_allowlist

  const additional_write_paths = cfg.additionalWritePaths
    ? [...(policy.additional_write_paths ?? []), ...cfg.additionalWritePaths]
    : policy.additional_write_paths

  return { kind: policy.kind, network_allowlist, additional_write_paths }
}

export const makeRidgelineEngine = (cfg: RidgelineEngineConfig): Engine => {
  const stall_timeout_ms =
    cfg.timeoutMinutes !== undefined ? cfg.timeoutMinutes * 60_000 : DEFAULT_STALL_TIMEOUT_MS

  const env = process.env
  const anthropicKey = env.ANTHROPIC_API_KEY

  // Activate providers in increasing precedence: env-key API providers form the
  // baseline, settings-supplied `providers` override them, and the
  // ridgeline-owned `claude_cli` wiring is reserved last so it can't be
  // clobbered. Model/version resolution itself is delegated to fascicle's
  // MODEL_FAMILIES catalog — ridgeline defines no aliases.
  const providers: EngineConfig["providers"] = {
    ...(anthropicKey ? { anthropic: { api_key: anthropicKey } } : {}),
    ...(env.OPENAI_API_KEY ? { openai: { api_key: env.OPENAI_API_KEY } } : {}),
    ...(env.GOOGLE_GENERATIVE_AI_API_KEY ? { google: { api_key: env.GOOGLE_GENERATIVE_AI_API_KEY } } : {}),
    ...(env.OPENROUTER_API_KEY ? { openrouter: { api_key: env.OPENROUTER_API_KEY } } : {}),
    ...(cfg.providers ?? {}),
    claude_cli: {
      auth_mode: "auto",
      sandbox: resolveSandbox(cfg),
      plugin_dirs: cfg.pluginDirs,
      setting_sources: cfg.settingSources,
      startup_timeout_ms: STARTUP_TIMEOUT_MS,
      stall_timeout_ms,
      skip_probe: env.VITEST === "true",
    },
  }

  // An explicit default provider is required once >1 provider is configured:
  // otherwise a bare family (`opus`) falls through to fascicle's `anthropic`
  // fallback and throws when no key is set. Preserve today's routing — key →
  // API, no key → subscription CLI — unless the caller pins a provider.
  const provider = cfg.provider ?? (anthropicKey ? "anthropic" : "claude_cli")

  return create_engine({ providers, defaults: { provider } })
}
