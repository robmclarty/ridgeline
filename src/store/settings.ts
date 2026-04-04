import * as fs from "node:fs"
import * as path from "node:path"

/** Domains Claude needs for authentication and API access — always allowlisted. */
export const CLAUDE_REQUIRED_DOMAINS: string[] = [
  "api.anthropic.com",
  "downloads.claude.ai",
  "http-intake.logs.us5.datadoghq.com",
]

export const DEFAULT_NETWORK_ALLOWLIST: string[] = [
  ...CLAUDE_REQUIRED_DOMAINS,
  "registry.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "static.crates.io",
  "rubygems.org",
  "proxy.golang.org",
  "github.com",
  "gitlab.com",
  "bitbucket.org",
]

export type RidgelineSettings = {
  network?: {
    allowlist?: string[]
  }
}

export const loadSettings = (ridgelineDir: string): RidgelineSettings => {
  const settingsPath = path.join(ridgelineDir, "settings.json")
  try {
    const raw = fs.readFileSync(settingsPath, "utf-8")
    return JSON.parse(raw) as RidgelineSettings
  } catch {
    return {}
  }
}

export const resolveNetworkAllowlist = (ridgelineDir: string): string[] => {
  const settings = loadSettings(ridgelineDir)
  const base = (settings.network?.allowlist && settings.network.allowlist.length > 0)
    ? settings.network.allowlist
    : [...DEFAULT_NETWORK_ALLOWLIST]
  // Always include Claude's required domains even if the user overrides the list
  const merged = new Set([...CLAUDE_REQUIRED_DOMAINS, ...base])
  return [...merged]
}
