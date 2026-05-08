// `--timeout <minutes>` maps onto two distinct fascicle timeouts: stall (per-call), startup (constant 120s).
import { create_engine, type AliasTable, type Engine, type EngineConfig } from "fascicle"
import type { SandboxFlag } from "./claude/sandbox.policy.js"

// When no ANTHROPIC_API_KEY is set, route the anthropic-default aliases through
// the claude_cli subprocess so subscription users aren't forced to learn the
// cli-* alias spelling.
const CLAUDE_CLI_ALIAS_OVERRIDES: AliasTable = {
  opus: { provider: "claude_cli", model_id: "claude-opus-4-7" },
  sonnet: { provider: "claude_cli", model_id: "claude-sonnet-4-6" },
  haiku: { provider: "claude_cli", model_id: "claude-haiku-4-5" },
  "claude-opus": { provider: "claude_cli", model_id: "claude-opus-4-7" },
  "claude-sonnet": { provider: "claude_cli", model_id: "claude-sonnet-4-6" },
  "claude-haiku": { provider: "claude_cli", model_id: "claude-haiku-4-5" },
}

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
}

export const makeRidgelineEngine = (cfg: RidgelineEngineConfig): Engine => {
  const stall_timeout_ms =
    cfg.timeoutMinutes !== undefined ? cfg.timeoutMinutes * 60_000 : DEFAULT_STALL_TIMEOUT_MS

  // auth_mode "oauth" (not "auto") so fascicle's build_env inherits process.env
  // — without it the spawn has no PATH and can't locate `claude`/`greywall`.
  //
  // sandbox is intentionally undefined: fascicle 0.3.x emits `--allow-host` /
  // `--rw` flags that greywall 0.3+ dropped (it now reads filesystem rules from
  // a JSON settings file, which ridgeline's runClaudeProcess path uses). The
  // fascicle-routed code paths (retrospective, refine) are read-mostly and run
  // without a sandbox here until fascicle's greywall integration is updated.
  const providers: EngineConfig["providers"] = {
    claude_cli: {
      auth_mode: "oauth",
      sandbox: undefined,
      plugin_dirs: cfg.pluginDirs,
      setting_sources: cfg.settingSources,
      startup_timeout_ms: STARTUP_TIMEOUT_MS,
      stall_timeout_ms,
      skip_probe: process.env.VITEST === "true",
    },
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    providers.anthropic = { api_key: anthropicKey }
  }

  const aliases = anthropicKey ? undefined : CLAUDE_CLI_ALIAS_OVERRIDES
  return create_engine({ providers, aliases })
}
