import { execSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir, homedir } from "node:os"
import { SandboxProvider } from "./sandbox.types"

const GREYPROXY_API = "http://localhost:43080"

/** Directories package managers need write access to for caching. */
const packageManagerCachePaths = (): string[] => {
  const home = homedir()
  return [
    join(home, ".npm"),           // npm
    join(home, ".cache"),         // pip, yarn berry, pnpm, misc
    join(home, ".yarn"),          // yarn classic
    join(home, ".pnpm-store"),    // pnpm
    join(home, ".cargo"),         // cargo
    join(home, ".local", "share"), // pip user installs, various tools
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
      const output = execSync("greywall check", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
      if (/✓.*greyproxy running/i.test(output)) {
        return null
      }
      return "greyproxy is not running. Start it with: greywall setup"
    } catch (err: unknown) {
      // greywall check exits non-zero when not ready — check stdout/stderr in the error
      const output = (err as { stdout?: string; stderr?: string }).stdout ?? ""
        + ((err as { stdout?: string; stderr?: string }).stderr ?? "")
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
  buildArgs(repoRoot: string, _networkAllowlist: string[], additionalWritePaths?: string[]): string[] {
    const writePaths = [repoRoot, "/tmp", ...packageManagerCachePaths(), ...(additionalWritePaths ?? [])]
    const settings: Record<string, unknown> = {
      filesystem: {
        allowWrite: writePaths,
      },
    }

    const settingsPath = join(tmpdir(), `ridgeline-greywall-${process.pid}.json`)
    writeFileSync(settingsPath, JSON.stringify(settings))

    return ["--auto-profile", "--no-credential-protection", "--settings", settingsPath, "--"]
  },
}
