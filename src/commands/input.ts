import * as fs from "node:fs"
import * as path from "node:path"

/**
 * Resolve a user-supplied input argument to either text or file content.
 *
 * Heuristic: if the string looks like a path (has an extension, starts with
 * a separator, or contains one) and the file exists on disk, read it.
 * Otherwise treat the input as raw text.
 */
export type ResolvedInput =
  | { type: "file"; path: string; content: string }
  | { type: "text"; content: string }

const looksLikeFilePath = (input: string): boolean =>
  /\.\w+$/.test(input) ||
  input.startsWith("/") ||
  input.startsWith("./") ||
  input.startsWith("../") ||
  input.includes(path.sep)

export const resolveInput = (input: string): ResolvedInput => {
  if (looksLikeFilePath(input)) {
    const resolved = path.resolve(input)
    if (fs.existsSync(resolved)) {
      return { type: "file", path: resolved, content: fs.readFileSync(resolved, "utf-8") }
    }
  }
  return { type: "text", content: input }
}

/** Extensions the bundle resolver picks up when given a directory. */
const BUNDLE_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".rst"])

/** Always-skipped directory names when walking a bundle directory. */
const BUNDLE_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".ridgeline",
  ".worktrees",
  "dist",
  "build",
  "coverage",
])

/** A bundle is a single source (file or text) or a concatenation of many files. */
export type ResolvedBundle =
  | { type: "file"; path: string; content: string }
  | { type: "directory"; path: string; files: string[]; content: string }
  | { type: "text"; content: string }

const walkBundleDir = (dir: string): string[] => {
  const out: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (BUNDLE_SKIP_DIRS.has(entry.name)) continue
      out.push(...walkBundleDir(full))
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (BUNDLE_EXTENSIONS.has(ext)) out.push(full)
    }
  }
  return out
}

const concatBundleFiles = (rootDir: string, files: string[]): string => {
  const sections: string[] = []
  for (const file of files) {
    const rel = path.relative(rootDir, file) || path.basename(file)
    const body = fs.readFileSync(file, "utf-8")
    sections.push(`## File: ${rel}\n\n${body.trim()}\n`)
  }
  return sections.join("\n---\n\n")
}

/**
 * Resolve an input that may point at a single file, a directory of source
 * documents, or be raw text. Directories are concatenated (sorted by relative
 * path) with a `## File: <relpath>` header before each file body so downstream
 * agents can see provenance.
 */
export const resolveInputBundle = (input: string): ResolvedBundle => {
  if (looksLikeFilePath(input)) {
    const resolved = path.resolve(input)
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved)
      if (stat.isDirectory()) {
        const files = walkBundleDir(resolved).sort()
        if (files.length === 0) {
          throw new Error(
            `Directory ${resolved} contains no readable source files (looked for: ${[...BUNDLE_EXTENSIONS].join(", ")})`,
          )
        }
        return {
          type: "directory",
          path: resolved,
          files,
          content: concatBundleFiles(resolved, files),
        }
      }
      if (stat.isFile()) {
        return {
          type: "file",
          path: resolved,
          content: fs.readFileSync(resolved, "utf-8"),
        }
      }
    }
  }
  return { type: "text", content: input }
}
