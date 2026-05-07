import * as fs from "node:fs"
import * as path from "node:path"

/**
 * Cross-phase discoveries — an append-only JSONL log of environmental
 * fixes and gotchas discovered during a build. Parallel phases write to
 * a single file in the main worktree (absolute path injected into the
 * builder's prompt), so a fix found by one builder is immediately
 * visible to siblings.
 *
 * The log is advisory, not authoritative. A discovery is a hint for the
 * next builder to verify, not a directive. To avoid merge conflicts on
 * shared runtime state, the file lives at a path covered by .gitignore
 * and is never committed.
 */

export interface DiscoveryEntry {
  /** ISO timestamp the entry was appended. */
  ts: string
  /** Phase that observed/fixed the issue, or `"harness"` for auto entries. */
  phase_id: string
  /** Short description of the blocker (one line). */
  blocker: string
  /** Short description of the solution applied or recommended (one line). */
  solution: string
  /** Optional path to evidence the solution worked (a check summary, a file). */
  evidence?: string
  /** Where the entry came from: harness-applied fix or agent-reported note. */
  source: "auto" | "agent"
}

const FILE_NAME = "discoveries.jsonl"

export const getDiscoveriesPath = (buildDir: string): string =>
  path.join(buildDir, FILE_NAME)

/**
 * Append a single discovery entry. POSIX guarantees atomic append for
 * writes <= PIPE_BUF (typically 4KB), so concurrent appenders writing
 * single-line JSON entries do not interleave under normal conditions.
 */
export const appendDiscovery = (buildDir: string, entry: DiscoveryEntry): void => {
  const filePath = getDiscoveriesPath(buildDir)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", { flag: "a" })
}

export const readDiscoveries = (buildDir: string): DiscoveryEntry[] => {
  const filePath = getDiscoveriesPath(buildDir)
  if (!fs.existsSync(filePath)) return []
  const raw = fs.readFileSync(filePath, "utf-8")
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as DiscoveryEntry)
}
