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

/**
 * Phase execution strategy.
 *
 * - `sequential` runs one phase at a time in-place (no worktrees).
 * - `manual` is `sequential` plus an inter-phase pause for user confirmation.
 * - `wave` uses the planner's DAG with unbounded parallelism inside worktrees.
 * - `wave` with finite `maxConcurrency` chunks each computed wave to at most N
 *   phases (e.g. the `"wave-2"` setting form).
 *
 * `wave-1` is intentionally distinct from `sequential`: it still creates a
 * worktree per phase (one at a time, with merge-back).
 */
export type SequencingMode =
  | { kind: "sequential" }
  | { kind: "manual" }
  | { kind: "wave"; maxConcurrency: number }

type RidgelineSettings = {
  network?: {
    allowlist?: string[]
  }
  assetDir?: string
  model?: string
  /**
   * Whether pipeline-entry commands pause for the preflight confirmation prompt.
   * Default true. Set to false (or pass `--no-preflight`) to skip the pause.
   */
  preflight?: boolean
  /**
   * Approximate cumulative USD ceiling for a run. The build halts once total
   * cost exceeds this. CLI `--max-budget-usd` overrides. Default: no cap.
   */
  maxBudgetUsd?: number
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
     * Phase execution strategy. One of:
     * - `"sequential"` (default): run phases one at a time, no worktrees.
     * - `"manual"`: `sequential` + pause between phases for user approval.
     * - `"wave"`: planner DAG with unbounded parallelism (isolated worktrees).
     * - `"wave-N"` where N is a positive integer: wave behavior, but each
     *   computed wave is chunked to size ≤ N.
     *
     * CLI `--sequencing <mode>` overrides this.
     */
    sequencing?: string
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
export const DEFAULT_SEQUENCING: SequencingMode = { kind: "sequential" }
export const DEFAULT_PREFLIGHT = true
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

/** CLI override wins; settings.json is consulted next; default is true (run the confirmation pause). */
export const resolvePreflight = (ridgelineDir: string, cliOverride?: boolean): boolean => {
  if (typeof cliOverride === "boolean") return cliOverride
  const raw = loadSettings(ridgelineDir).preflight
  if (typeof raw === "boolean") return raw
  return DEFAULT_PREFLIGHT
}

/** CLI override (string from --max-budget-usd) wins; settings.json next; default null (no cap). */
export const resolveMaxBudgetUsd = (ridgelineDir: string, cliOverride?: string): number | null => {
  if (cliOverride !== undefined && cliOverride !== "") {
    const n = parseFloat(cliOverride)
    if (Number.isFinite(n) && n > 0) return n
  }
  const raw = loadSettings(ridgelineDir).maxBudgetUsd
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw
  return null
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
 * Parse a sequencing-mode string into its discriminated union form.
 * Returns `null` for any input that doesn't match a known mode.
 */
export const parseSequencing = (raw: unknown): SequencingMode | null => {
  if (typeof raw !== "string") return null
  if (raw === "sequential") return { kind: "sequential" }
  if (raw === "manual") return { kind: "manual" }
  if (raw === "wave") return { kind: "wave", maxConcurrency: Infinity }
  const match = /^wave-(\d+)$/.exec(raw)
  if (match) {
    const n = parseInt(match[1], 10)
    if (Number.isFinite(n) && n >= 1) return { kind: "wave", maxConcurrency: n }
  }
  return null
}

/**
 * Resolve the phase execution strategy.
 *
 * Precedence: CLI override → settings.json → default {@link DEFAULT_SEQUENCING}.
 * Invalid values at any layer fall through to the next.
 */
export const resolveSequencing = (
  ridgelineDir: string,
  cliOverride?: string,
): SequencingMode => {
  if (cliOverride !== undefined) {
    const parsed = parseSequencing(cliOverride)
    if (parsed) return parsed
  }
  const raw = loadSettings(ridgelineDir).build?.sequencing
  const parsed = parseSequencing(raw)
  return parsed ?? DEFAULT_SEQUENCING
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
