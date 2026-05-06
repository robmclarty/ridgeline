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
    /**
     * Approximate USD ceiling per phase (used to advise the planner). Default 15.
     * Set to `null` (or the string `"unlimited"`) to disable the cost advisory entirely;
     * the planner will size phases purely by `phaseTokenLimit` (context-window-driven).
     */
    phaseBudgetLimit?: number | null | "unlimited"
    /** Approximate output-token ceiling per phase (used to advise the planner). Default 50000. */
    phaseTokenLimit?: number
    /** Number of specialists to run for planner/researcher ensembles. Default 3. */
    specialistCount?: 1 | 2 | 3
  }
  /**
   * Per-Claude-invocation timeout in minutes. Number, or `"unlimited"` to disable
   * the per-call timeout (a 24-hour catchall still applies to recover from truly
   * hung processes). CLI `--timeout` overrides this.
   */
  timeoutMinutes?: number | "unlimited"
  /**
   * Per-model context-window override (in tokens). Distinct from
   * `phaseTokenLimit` — this is the model's HARD ceiling; exceeding it
   * truncates output. Defaults to 200,000 for unknown models.
   *
   * Example: `{ "claude-sonnet-4-6": 1000000 }` for the 1M-context variant.
   */
  contextWindows?: Record<string, number>
  build?: {
    /**
     * Pause between phases for explicit user confirmation.
     * Default `false`. CLI `--require-phase-approval` overrides this.
     */
    requirePhaseApproval?: boolean
  }
  directions?: {
    /** Number of visual direction options to generate (2 or 3). Default 2. */
    count?: 2 | 3
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
export const DEFAULT_PHASE_TOKEN_LIMIT = 50000
export const DEFAULT_SPECIALIST_COUNT: 1 | 2 | 3 = 3
export const DEFAULT_DIRECTION_COUNT: 2 | 3 = 2
export const DEFAULT_SANDBOX_MODE: SandboxMode = "semi-locked"
/**
 * Catchall timeout applied when the user requests `"unlimited"` per-call timeout.
 * Far above any normal phase, but bounded so a truly hung Claude process eventually
 * dies instead of running forever.
 */
export const UNLIMITED_TIMEOUT_CATCHALL_MINUTES = 1440

export const resolveSpecialistTimeoutSeconds = (ridgelineDir: string): number => {
  const raw = loadSettings(ridgelineDir).specialistTimeoutSeconds
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_SPECIALIST_TIMEOUT_SECONDS
  }
  return Math.floor(raw)
}

export const resolvePhaseBudgetLimit = (ridgelineDir: string): number | null => {
  const raw = loadSettings(ridgelineDir).planner?.phaseBudgetLimit
  if (raw === null || raw === "unlimited") return null
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_PHASE_BUDGET_LIMIT_USD
  }
  return raw
}

/**
 * Resolve whether to gate phase advancement on user approval.
 *
 * Precedence: CLI override (true → on) → settings.json → default false.
 */
export const resolveRequirePhaseApproval = (
  ridgelineDir: string,
  cliOverride: boolean | undefined,
): boolean => {
  if (cliOverride === true) return true
  const raw = loadSettings(ridgelineDir).build?.requirePhaseApproval
  return raw === true
}

/**
 * Resolve the per-Claude-invocation timeout in minutes.
 *
 * Precedence: CLI override → settings.json → default. CLI `"unlimited"` and
 * settings.json `"unlimited"` (or `null`) both map to {@link UNLIMITED_TIMEOUT_CATCHALL_MINUTES}.
 */
export const resolveTimeoutMinutes = (
  ridgelineDir: string,
  cliOverride: string | undefined,
  defaultMinutes: number,
): number => {
  if (cliOverride !== undefined) {
    if (cliOverride === "unlimited") return UNLIMITED_TIMEOUT_CATCHALL_MINUTES
    const parsed = parseInt(cliOverride, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
    return defaultMinutes
  }
  const raw = loadSettings(ridgelineDir).timeoutMinutes
  if (raw === "unlimited" || raw === null) return UNLIMITED_TIMEOUT_CATCHALL_MINUTES
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw)
  return defaultMinutes
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

const isValidDirectionCount = (n: unknown): n is 2 | 3 => n === 2 || n === 3

/** CLI override wins; settings.json is consulted next; default is 2. */
export const resolveDirectionCount = (
  ridgelineDir: string,
  cliOverride?: number,
): 2 | 3 => {
  if (isValidDirectionCount(cliOverride)) return cliOverride
  const raw = loadSettings(ridgelineDir).directions?.count
  if (isValidDirectionCount(raw)) return raw
  return DEFAULT_DIRECTION_COUNT
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
