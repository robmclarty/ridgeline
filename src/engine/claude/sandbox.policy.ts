import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { SandboxBuildArgsOptions, SandboxProvider } from "./sandbox.types.js"
import type { SandboxMode } from "../../stores/settings.js"

const GREYPROXY_API = "http://localhost:43080"

// Greywall profiles compose two halves: an agent profile (claude config dirs +
// Anthropic/GitHub endpoints) and toolchain profiles (npm/pnpm/yarn/bun/deno,
// python via uv, ruby, go, cargo, docker, generic SCM). Strict mode stays
// minimal; semi-locked mode (default) opts into the broad ecosystem set so
// binary tools the build needs (Playwright, MCP servers, agent-browser)
// generally just work without per-build configuration.
const STRICT_PROFILES = ["claude", "node"]
const SEMI_LOCKED_PROFILES = ["claude", "node", "python", "ruby", "go", "cargo", "docker"]

const resolveProfiles = (mode: SandboxMode, extra: string[]): string => {
  const base = mode === "strict" ? STRICT_PROFILES : SEMI_LOCKED_PROFILES
  return Array.from(new Set([...base, ...extra])).join(",")
}

// Path-specific holes the semi-locked mode opens beyond what greywall's
// built-in profiles cover. Each entry was a known break in the strict mode
// during v0 weft (chromium cache, agent-browser socket dir, uv cache, etc.).
// Users can layer more via `sandbox.extraWritePaths` in settings.json.
const semiLockedWritePaths = (): string[] => {
  const home = homedir()
  return [
    `${home}/.agent-browser`,
    `${home}/.cache/uv`,
    `${home}/.cache/pip`,
    `${home}/.cache/playwright`,
    `${home}/Library/Caches/Cypress`,
    `${home}/Library/Caches/ms-playwright`,
  ]
}

/**
 * Default network allowlist for `--sandbox semi-locked`.
 *
 * Mirrors the pre-migration `DEFAULT_NETWORK_ALLOWLIST` resolved by
 * src/stores/settings.ts (CLAUDE_REQUIRED_DOMAINS + ecosystem hosts), captured
 * as the source of truth in
 * .ridgeline/builds/fascicle-migration/baseline/sandbox-allowlist.semi-locked.json.
 * Any addition is a widening — explicitly forbidden by Phase 2's spec.
 */
export const DEFAULT_NETWORK_ALLOWLIST_SEMI_LOCKED: readonly string[] = Object.freeze([
  "api.anthropic.com",
  "downloads.claude.ai",
  "http-intake.logs.us5.datadoghq.com",
  "registry.npmjs.org",
  "nodejs.org",
  "objects.githubusercontent.com",
  "raw.githubusercontent.com",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "static.crates.io",
  "rubygems.org",
  "proxy.golang.org",
  "github.com",
  "gitlab.com",
  "bitbucket.org",
])

/**
 * Default network allowlist for `--sandbox strict`.
 *
 * Identical host set to semi-locked because pre-migration ridgeline's allowlist
 * resolver is independent of sandbox mode (mode varies toolchain *profiles*
 * and write paths, not the host filter). Captured in
 * .ridgeline/builds/fascicle-migration/baseline/sandbox-allowlist.strict.json
 * as the upper bound; strict mode may legitimately narrow but never widens.
 */
export const DEFAULT_NETWORK_ALLOWLIST_STRICT: readonly string[] = Object.freeze([
  "api.anthropic.com",
  "downloads.claude.ai",
  "http-intake.logs.us5.datadoghq.com",
  "registry.npmjs.org",
  "nodejs.org",
  "objects.githubusercontent.com",
  "raw.githubusercontent.com",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "static.crates.io",
  "rubygems.org",
  "proxy.golang.org",
  "github.com",
  "gitlab.com",
  "bitbucket.org",
])

/**
 * Structural mirror of fascicle's internal `SandboxProviderConfig` (not exported
 * by fascicle 0.3.x). Phase 4's engine factory passes the result of
 * `buildSandboxPolicy` straight into `claude_cli.sandbox`; structural typing
 * lets the values flow through without an alias re-export.
 */
export type SandboxProviderConfig =
  | {
      readonly kind: "bwrap"
      readonly network_allowlist?: readonly string[]
      readonly additional_write_paths?: readonly string[]
    }
  | {
      readonly kind: "greywall"
      readonly network_allowlist?: readonly string[]
      readonly additional_write_paths?: readonly string[]
    }

export type SandboxFlag = "off" | "semi-locked" | "strict"

type BuildSandboxPolicyArgs = {
  sandboxFlag: SandboxFlag
  buildPath: string
}

/**
 * Map ridgeline's `--sandbox` flag values to fascicle's `SandboxProviderConfig`.
 *
 * - `off`: no sandbox; returns `undefined`.
 * - `semi-locked` / `strict`: greywall with a non-widened allowlist + per-build
 *   write paths. `buildPath` is always the first entry of
 *   `additional_write_paths`.
 */
export const buildSandboxPolicy = (
  args: BuildSandboxPolicyArgs,
): SandboxProviderConfig | undefined => {
  if (args.sandboxFlag === "off") return undefined

  const isStrict = args.sandboxFlag === "strict"
  const network_allowlist = isStrict
    ? [...DEFAULT_NETWORK_ALLOWLIST_STRICT]
    : [...DEFAULT_NETWORK_ALLOWLIST_SEMI_LOCKED]

  const additional_write_paths = isStrict
    ? [args.buildPath, "/tmp"]
    : [args.buildPath, "/tmp", ...semiLockedWritePaths()]

  return {
    kind: "greywall",
    network_allowlist,
    additional_write_paths,
  }
}

/** Ensure a greyproxy allow rule exists for the given domain. */
const ensureRule = async (domain: string, existingDestinations: Set<string>): Promise<void> => {
  if (existingDestinations.has(domain)) return
  const body = JSON.stringify({
    container_pattern: "claude*",
    destination_pattern: domain,
    port_pattern: "443",
    rule_type: "permanent",
    action: "allow",
    created_by: "ridgeline",
    notes: `Ridgeline network allowlist`,
  })
  const res = await fetch(`${GREYPROXY_API}/api/rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })
  if (!res.ok) {
    throw new Error(`Failed to create greyproxy rule for ${domain}: ${res.status} ${await res.text()}`)
  }
}

export const greywallProvider: SandboxProvider = {
  name: "greywall",
  command: "greywall",
  checkReady(): string | null {
    try {
      const output = execFileSync("greywall", ["check"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
      if (/✓.*greyproxy running/i.test(output)) {
        return null
      }
      return "greyproxy is not running. Start it with: greywall setup"
    } catch (err: unknown) {
      // greywall check exits non-zero when not ready — check stdout/stderr in the error
      const e = err as { stdout?: string; stderr?: string }
      const output = (e.stdout ?? "") + (e.stderr ?? "")
      if (/✓.*greyproxy running/i.test(output)) {
        return null
      }
      return "greyproxy is not running. Start it with: greywall setup"
    }
  },
  async syncRules(networkAllowlist: string[]): Promise<void> {
    if (networkAllowlist.length === 0) return

    // Fetch existing rules to avoid duplicates
    const res = await fetch(`${GREYPROXY_API}/api/rules`)
    if (!res.ok) {
      throw new Error(`Failed to fetch greyproxy rules: ${res.status}`)
    }
    const data = (await res.json()) as { items: { destination_pattern: string }[] }
    const existing = new Set(data.items.map((r) => r.destination_pattern))

    await Promise.all(networkAllowlist.map((domain) => ensureRule(domain, existing)))
  },
  buildArgs(
    repoRoot: string,
    _networkAllowlist: string[],
    options?: SandboxBuildArgsOptions,
  ): string[] {
    const mode: SandboxMode = options?.mode ?? "semi-locked"
    const extras = options?.extras ?? { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] }
    const additionalWritePaths = options?.additionalWritePaths ?? []

    const writePaths = [
      repoRoot,
      "/tmp",
      ...(mode === "semi-locked" ? semiLockedWritePaths() : []),
      ...extras.writePaths,
      ...additionalWritePaths,
    ]

    const settings: Record<string, unknown> = {
      filesystem: {
        allowWrite: writePaths,
        ...(extras.readPaths.length > 0 ? { allowRead: extras.readPaths } : {}),
      },
    }

    const settingsPath = join(tmpdir(), `ridgeline-greywall-${process.pid}.json`)
    writeFileSync(settingsPath, JSON.stringify(settings))

    return [
      "--profile", resolveProfiles(mode, extras.profiles),
      "--no-credential-protection",
      "--settings", settingsPath,
      "--",
    ]
  },
}

/**
 * Cross-platform `which`-style probe used by `detectSandbox` to decide whether
 * the greywall CLI is on the host. Lives here so sandbox.ts can stay free of
 * `node:child_process` (enforced by an ast-grep rule).
 */
export const isAvailable = (cmd: string): boolean => {
  try {
    execFileSync("which", [cmd], { stdio: ["pipe", "pipe", "pipe"] })
    return true
  } catch {
    return false
  }
}
