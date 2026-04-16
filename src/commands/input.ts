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

export const resolveInput = (input: string): ResolvedInput => {
  const looksLikeFile =
    /\.\w+$/.test(input) ||
    input.startsWith("/") ||
    input.startsWith("./") ||
    input.startsWith("../") ||
    input.includes(path.sep)
  if (looksLikeFile) {
    const resolved = path.resolve(input)
    if (fs.existsSync(resolved)) {
      return { type: "file", path: resolved, content: fs.readFileSync(resolved, "utf-8") }
    }
  }
  return { type: "text", content: input }
}
