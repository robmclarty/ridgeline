// `--timeout <minutes>` maps onto two distinct fascicle timeouts: stall (per-call), startup (constant 120s).
import { create_engine, type Engine } from "fascicle"
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

  return create_engine({
    providers: {
      claude_cli: {
        auth_mode: "auto",
        sandbox: resolveSandbox(cfg),
        plugin_dirs: cfg.pluginDirs,
        setting_sources: cfg.settingSources,
        startup_timeout_ms: STARTUP_TIMEOUT_MS,
        stall_timeout_ms,
        skip_probe: process.env.VITEST === "true",
      },
    },
  })
}
