import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { SandboxBuildArgsOptions, SandboxProvider } from "./sandbox.types"
import type { SandboxMode } from "../../stores/settings"

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
