import * as fs from "node:fs"
import * as path from "node:path"
import { pathScopeError, isPathScopeError } from "./types.js"

/**
 * Resolve `requested` (absolute, or relative to `root`) to an absolute path and
 * assert it stays within `root`. This is the application-level containment that
 * replaces the Claude CLI sandbox's filesystem confinement for the in-process
 * read/write tools — Bash gets greywall on top, but Read/Write/Edit/Glob/Grep
 * are plain `node:fs` calls that must not be allowed to escape the workspace.
 *
 * `realpathSync` on the nearest EXISTING ancestor defeats `..` traversal and
 * symlink escapes without requiring the leaf to exist (Write targets new files).
 */
export const resolveWithinRoot = (root: string, requested: string): string => {
  const realRoot = fs.realpathSync(root)
  const abs = path.resolve(realRoot, requested)

  // Walk up to the nearest existing ancestor, realpath it, re-append the tail.
  let existing = abs
  const tail: string[] = []
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) {
    tail.unshift(path.basename(existing))
    existing = path.dirname(existing)
  }
  const realExisting = fs.realpathSync(existing)
  const resolved = tail.length > 0 ? path.join(realExisting, ...tail) : realExisting

  const rel = path.relative(realRoot, resolved)
  if (rel === "") return resolved
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw pathScopeError(requested, root)
  }
  return resolved
}

/**
 * Like {@link resolveWithinRoot} but accepts several allowed roots (e.g. the cwd
 * plus a buildDir that lives outside it). Resolves against the first root that
 * contains the path; throws scoped to the primary root if none do.
 */
export const resolveWithinRoots = (roots: readonly string[], requested: string): string => {
  if (roots.length === 0) throw pathScopeError(requested, "<none>")
  for (const root of roots) {
    try {
      return resolveWithinRoot(root, requested)
    } catch (err) {
      if (!isPathScopeError(err)) throw err
    }
  }
  throw pathScopeError(requested, roots[0])
}
