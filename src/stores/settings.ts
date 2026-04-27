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

export type SandboxMode = "off" | "semi-locked" | "strict"

export type SandboxExtras = {
  writePaths: string[]
  readPaths: string[]
  profiles: string[]
  networkAllowlist: string[]
}

type RidgelineSettings = {
  network?: {
    allowlist?: string[]
  }
  assetDir?: string
  model?: string
  /**
   * Per-call specialist timeout in seconds. Recommended 180–600.
   * Applies to ensemble specialist invocations (planner, specifier, researcher).
   */
  specialistTimeoutSeconds?: number
  planner?: {
    /** Approximate USD ceiling per phase (used to advise the planner). Default 15. */
    phaseBudgetLimit?: number
    /** Approximate output-token ceiling per phase (used to advise the planner). Default 80000. */
    phaseTokenLimit?: number
    /** Number of specialists to run for planner/researcher ensembles. Default 3. */
    specialistCount?: 1 | 2 | 3
  }
  sandbox?: {
    /** Sandbox strictness. `semi-locked` (default) composes broad toolchain profiles for binary-tool support. */
    mode?: SandboxMode
    /** Extra paths the sandbox can write to (e.g. ~/.agent-browser). */
    extraWritePaths?: string[]
    /** Extra paths the sandbox can read from (e.g. shared config dirs). */
    extraReadPaths?: string[]
    /** Extra greywall toolchain profiles (e.g. "python", "docker"). */
    extraProfiles?: string[]
    /** Extra network domains appended to the active allowlist. */
    extraNetworkAllowlist?: string[]
  }
}

export const DEFAULT_SPECIALIST_TIMEOUT_SECONDS = 600
export const DEFAULT_PHASE_BUDGET_LIMIT_USD = 15
export const DEFAULT_PHASE_TOKEN_LIMIT = 80000
export const DEFAULT_SPECIALIST_COUNT: 1 | 2 | 3 = 3
export const DEFAULT_SANDBOX_MODE: SandboxMode = "semi-locked"

export const resolveSpecialistTimeoutSeconds = (ridgelineDir: string): number => {
  const raw = loadSettings(ridgelineDir).specialistTimeoutSeconds
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_SPECIALIST_TIMEOUT_SECONDS
  }
  return Math.floor(raw)
}

export const resolvePhaseBudgetLimit = (ridgelineDir: string): number => {
  const raw = loadSettings(ridgelineDir).planner?.phaseBudgetLimit
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_PHASE_BUDGET_LIMIT_USD
  }
  return raw
}

export const resolvePhaseTokenLimit = (ridgelineDir: string): number => {
  const raw = loadSettings(ridgelineDir).planner?.phaseTokenLimit
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_PHASE_TOKEN_LIMIT
  }
  return Math.floor(raw)
}

const isValidSpecialistCount = (n: unknown): n is 1 | 2 | 3 =>
  n === 1 || n === 2 || n === 3

/** CLI override wins; settings.json is consulted next; default is 3. */
export const resolveSpecialistCount = (
  ridgelineDir: string,
  cliOverride?: number,
): 1 | 2 | 3 => {
  if (isValidSpecialistCount(cliOverride)) return cliOverride
  const raw = loadSettings(ridgelineDir).planner?.specialistCount
  if (isValidSpecialistCount(raw)) return raw
  return DEFAULT_SPECIALIST_COUNT
}

const isValidSandboxMode = (m: unknown): m is SandboxMode =>
  m === "off" || m === "semi-locked" || m === "strict"

/** CLI override wins; settings.json is consulted next; default is "semi-locked". */
export const resolveSandboxMode = (
  ridgelineDir: string,
  cliOverride?: string,
): SandboxMode => {
  if (isValidSandboxMode(cliOverride)) return cliOverride
  const raw = loadSettings(ridgelineDir).sandbox?.mode
  if (isValidSandboxMode(raw)) return raw
  return DEFAULT_SANDBOX_MODE
}

const sanitizeStringArray = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === "string" && v.length > 0)
}

export const resolveSandboxExtras = (ridgelineDir: string): SandboxExtras => {
  const sandbox = loadSettings(ridgelineDir).sandbox ?? {}
  return {
    writePaths: sanitizeStringArray(sandbox.extraWritePaths),
    readPaths: sanitizeStringArray(sandbox.extraReadPaths),
    profiles: sanitizeStringArray(sandbox.extraProfiles),
    networkAllowlist: sanitizeStringArray(sandbox.extraNetworkAllowlist),
  }
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
