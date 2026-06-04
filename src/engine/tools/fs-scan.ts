import * as fs from "node:fs"
import * as path from "node:path"

/**
 * Glob for files under `base`, returning absolute paths to regular files only.
 * Drops directory matches (globSync yields them) and any match that escaped
 * `base` via `..` in the pattern. Shared by the Glob and Grep tools.
 */
export const globFilesWithin = (base: string, pattern: string): string[] =>
  fs
    .globSync(pattern, { cwd: base })
    .map((rel) => path.resolve(base, rel))
    .filter((abs) => {
      const rel = path.relative(base, abs)
      if (rel.startsWith("..") || path.isAbsolute(rel)) return false
      try {
        return fs.statSync(abs).isFile()
      } catch {
        return false
      }
    })
