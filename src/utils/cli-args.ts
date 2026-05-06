import * as fs from "node:fs"
import * as path from "node:path"

export const slugify = (s: string): string =>
  s.toLowerCase().replace(/\.[^./]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

/**
 * Resolve the build-name + input pair from positional args, supporting both
 * forms:
 *
 * - explicit: `ridgeline my-name ./spec.md`
 * - derived:  `ridgeline ./spec.md`  (build name = slugified basename of input)
 *
 * The derived form fires only when the first arg resolves to an existing file
 * or directory. Otherwise the first arg is treated as a build name.
 */
export const resolveNameAndInput = (
  arg1: string | undefined,
  arg2: string | undefined,
): { buildName: string | undefined; input: string | undefined } => {
  if (arg1 && arg2) return { buildName: arg1, input: arg2 }
  if (arg1 && !arg2) {
    const resolved = path.resolve(arg1)
    if (fs.existsSync(resolved)) {
      const base = path.basename(resolved)
      return { buildName: slugify(base), input: arg1 }
    }
    return { buildName: arg1, input: undefined }
  }
  return { buildName: undefined, input: undefined }
}

/**
 * Parse a commander `[n]`-style optional-arg flag (raw can be undefined,
 * boolean true, or a numeric string) into a positive integer. Falls back to
 * defaultN for any non-numeric or negative input.
 */
export const parseAutoCount = (
  raw: string | boolean | undefined,
  defaultN: number,
): number | undefined => {
  if (raw === undefined) return undefined
  if (raw === true) return defaultN
  const n = parseInt(String(raw), 10)
  if (isNaN(n) || n < 1) return defaultN
  return n
}
