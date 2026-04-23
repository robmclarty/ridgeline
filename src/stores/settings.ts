import * as fs from "node:fs"
import * as path from "node:path"

/** Domains Claude needs for authentication and API access — always allowlisted. */
export const CLAUDE_REQUIRED_DOMAINS: string[] = [
  "api.anthropic.com",
  "downloads.claude.ai",
  "http-intake.logs.us5.datadoghq.com",
]

/** Additional domains needed for research agents (web search, docs, academic). */
const RESEARCH_NETWORK_DOMAINS: string[] = [
  "arxiv.org",
  "export.arxiv.org",
  "api.semanticscholar.org",
  "scholar.google.com",
  "docs.python.org",
  "developer.mozilla.org",
  "docs.rs",
  "pkg.go.dev",
  "learn.microsoft.com",
  "devdocs.io",
]

export const DEFAULT_NETWORK_ALLOWLIST: string[] = [
  ...CLAUDE_REQUIRED_DOMAINS,
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
]

type RidgelineSettings = {
  network?: {
    allowlist?: string[]
  }
  assetDir?: string
  model?: string
}

/** Resolve the model to use: CLI opt wins, then settings.json, then built-in default. */
export const resolveModel = (optModel: string | undefined, ridgelineDir: string): string =>
  optModel ?? loadSettings(ridgelineDir).model ?? "opus"

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
  // Wildcard means unrestricted — return empty so greywall omits network filtering
  if (base.includes("*")) return []
  // Always include Claude's required domains even if the user overrides the list
  const merged = new Set([...CLAUDE_REQUIRED_DOMAINS, ...base])
  return [...merged]
}

/** Build the network allowlist for research agents: base allowlist + research domains. */
export const resolveResearchAllowlist = (ridgelineDir: string): string[] => {
  const base = resolveNetworkAllowlist(ridgelineDir)
  // If base is empty, user set "*" (unrestricted) — keep it unrestricted
  if (base.length === 0) return []
  const merged = new Set([...base, ...RESEARCH_NETWORK_DOMAINS])
  return [...merged]
}
