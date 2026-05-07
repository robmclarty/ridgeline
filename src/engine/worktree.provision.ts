import * as fs from "node:fs"
import * as path from "node:path"
import { appendDiscovery } from "./pipeline/discoveries.js"

/**
 * Post-worktree-creation environment provisioning.
 *
 * `git worktree add` checks out the branch's tracked tree but does not
 * carry over `node_modules`. Phase builders typically run
 * `npm install --ignore-scripts` to fill it in, which leaves any
 * binaries that depend on a postinstall download (agnix, esbuild,
 * playwright, etc.) missing. When those binaries are blocked from
 * fetching by the active sandbox, every parallel phase rediscovers the
 * same blocker and burns time / tokens trying to work around it.
 *
 * This module fixes that once, in the harness, by mirroring known
 * package binaries from the main worktree's `node_modules` into each
 * phase worktree as soon as the worktree is created. Each successful
 * fix is logged to discoveries.jsonl so sibling phases (and humans
 * reading the audit trail) can see what was applied.
 */

/** A package binary the harness will mirror from main → worktree if missing. */
export interface BinaryFix {
  /** Package directory under `node_modules/`. */
  pkg: string
  /** Path to the binary file relative to the package directory. */
  binPath: string
  /** Why this fix exists — surfaces in the discoveries entry. */
  why: string
}

/**
 * Known fixes. Add entries here when a package's postinstall is reliably
 * blocked under sandboxed builds. Keep the list small — fixes that don't
 * apply (binary already present, package not installed) are no-ops.
 */
export const KNOWN_BINARY_FIXES: readonly BinaryFix[] = [
  {
    pkg: "agnix",
    binPath: "bin/agnix-binary",
    why: "agnix postinstall fetches the platform binary from github.com release assets; that host is not on the semi-locked sandbox allowlist, so the fetch fails and the agents check fails with 'agnix binary not found'.",
  },
]

interface ProvisionResult {
  /** Identifier for the fix that ran. */
  fix: string
  /** True if the fix was applied (i.e., something changed). */
  applied: boolean
  /** Detail line — what was done, or why the fix was skipped. */
  detail: string
}

const symlinkExists = (p: string): boolean => {
  try {
    fs.lstatSync(p)
    return true
  } catch {
    return false
  }
}

const fileResolves = (p: string): boolean => {
  try {
    fs.statSync(p)
    return true
  } catch {
    return false
  }
}

/**
 * Mirror a single package binary from main → worktree if it's missing.
 * Idempotent: returns `{applied: false}` when the binary already
 * resolves in the worktree, when the package isn't installed in the
 * worktree, or when main has nothing to mirror from.
 */
const mirrorBinary = (
  fix: BinaryFix,
  wtPath: string,
  mainCwd: string,
): ProvisionResult => {
  const id = `mirror:${fix.pkg}/${fix.binPath}`
  const wtPkgDir = path.join(wtPath, "node_modules", fix.pkg)
  const wtBin = path.join(wtPkgDir, fix.binPath)
  const mainBin = path.join(mainCwd, "node_modules", fix.pkg, fix.binPath)

  if (!fs.existsSync(wtPkgDir)) {
    return { fix: id, applied: false, detail: `package not installed in worktree` }
  }

  if (fileResolves(wtBin)) {
    return { fix: id, applied: false, detail: `binary already present in worktree` }
  }

  if (!fileResolves(mainBin)) {
    return { fix: id, applied: false, detail: `no source binary in main worktree` }
  }

  // Remove a dangling symlink if one exists, then create a fresh one.
  if (symlinkExists(wtBin)) {
    try { fs.unlinkSync(wtBin) } catch { /* ignore */ }
  }
  fs.mkdirSync(path.dirname(wtBin), { recursive: true })
  fs.symlinkSync(mainBin, wtBin)

  return { fix: id, applied: true, detail: `symlinked ${wtBin} → ${mainBin}` }
}

interface ProvisionOptions {
  /** Phase id for discoveries attribution. Defaults to `"harness"`. */
  phaseId?: string
  /** Build directory (where discoveries.jsonl lives). When omitted, fixes still apply but nothing is logged. */
  buildDir?: string
  /** Override the fix list — primarily for tests. */
  fixes?: readonly BinaryFix[]
}

/**
 * Provision a freshly-created phase worktree. Runs every fix in order;
 * collects per-fix results. Each applied fix appends a discovery entry
 * so sibling phases can see what's already been handled.
 */
export const provisionPhaseWorktree = (
  wtPath: string,
  mainCwd: string,
  opts: ProvisionOptions = {},
): ProvisionResult[] => {
  const fixes = opts.fixes ?? KNOWN_BINARY_FIXES
  const phaseId = opts.phaseId ?? "harness"
  const results: ProvisionResult[] = []

  for (const fix of fixes) {
    const result = mirrorBinary(fix, wtPath, mainCwd)
    results.push(result)
    if (result.applied && opts.buildDir) {
      appendDiscovery(opts.buildDir, {
        ts: new Date().toISOString(),
        phase_id: phaseId,
        blocker: fix.why,
        solution: result.detail,
        source: "auto",
      })
    }
  }

  return results
}
