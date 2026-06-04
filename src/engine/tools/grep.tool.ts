import * as fs from "node:fs"
import * as path from "node:path"
import { z } from "zod"
import { defineTool, type ToolFactoryContext } from "./types.js"
import { resolveWithinRoot } from "./path-scope.js"
import { globFilesWithin } from "./fs-scan.js"

/** Directories never worth scanning; keeps the walk fast and output relevant. */
const ALWAYS_EXCLUDE = new Set(["node_modules", ".git"])

function* walkFiles(dir: string): Generator<string> {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ALWAYS_EXCLUDE.has(entry.name)) continue
      yield* walkFiles(path.join(dir, entry.name))
    } else if (entry.isFile()) {
      yield path.join(dir, entry.name)
    }
  }
}

const looksBinary = (buf: Buffer): boolean => {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

type FileHits = { file: string; lines: { n: number; text: string }[] }

/**
 * Search file contents with a regular expression — a dependency-free JS scanner
 * that reproduces the Claude CLI built-in `Grep`'s output contract (content /
 * files_with_matches / count, `-i`, `-n`, `head_limit`). Read-only and scoped
 * to the workspace root. (ripgrep acceleration can be layered on later behind an
 * `isAvailable("rg")` probe with the same contract.)
 */
export const makeGrepTool = (ctx: ToolFactoryContext) =>
  defineTool({
    name: "Grep",
    description:
      "Search file contents with a regular expression. output_mode: " +
      "'files_with_matches' (default), 'content', or 'count'. Supports -i " +
      "(case-insensitive), -n (line numbers in content mode), a glob filter, and head_limit.",
    input_schema: z.object({
      pattern: z.string().describe("Regular expression to search for."),
      path: z.string().optional().describe("File or directory to search; defaults to the workspace root."),
      glob: z.string().optional().describe("Restrict the search to files matching this glob."),
      output_mode: z.enum(["content", "files_with_matches", "count"]).default("files_with_matches"),
      "-i": z.boolean().optional().describe("Case-insensitive search."),
      "-n": z.boolean().optional().describe("Include line numbers (content mode)."),
      head_limit: z.number().int().positive().optional().describe("Cap the number of output entries."),
    }),
    execute: (input) => {
      const base = resolveWithinRoot(ctx.cwd, input.path ?? ".")
      let re: RegExp
      try {
        re = new RegExp(input.pattern, input["-i"] ? "i" : "")
      } catch (err) {
        throw new Error(`Invalid regular expression: ${(err as Error).message}`)
      }

      const candidates = collectCandidates(base, input.glob)
      const matches: FileHits[] = []
      for (const file of candidates) {
        let buf: Buffer
        try {
          buf = fs.readFileSync(file)
        } catch {
          continue
        }
        if (looksBinary(buf)) continue
        const lines = buf.toString("utf-8").split("\n")
        const hits = lines
          .map((text, i) => ({ n: i + 1, text }))
          .filter((l) => re.test(l.text))
        if (hits.length > 0) matches.push({ file, lines: hits })
      }

      return renderOutput(matches, input.output_mode, input["-n"] ?? false, input.head_limit)
    },
  })

const collectCandidates = (base: string, glob: string | undefined): string[] => {
  const stat = (() => {
    try {
      return fs.statSync(base)
    } catch {
      return null
    }
  })()
  if (stat?.isFile()) return [base]
  if (!glob) return [...walkFiles(base)]
  return globFilesWithin(base, glob)
}

const renderOutput = (
  matches: FileHits[],
  mode: "content" | "files_with_matches" | "count",
  withLineNumbers: boolean,
  headLimit: number | undefined,
): string => {
  const cap = (rows: string[]): string =>
    (headLimit ? rows.slice(0, headLimit) : rows).join("\n") || "No matches found."

  if (mode === "files_with_matches") return cap(matches.map((m) => m.file))
  if (mode === "count") return cap(matches.map((m) => `${m.file}:${m.lines.length}`))
  // content
  const rows: string[] = []
  for (const m of matches) {
    for (const hit of m.lines) {
      rows.push(withLineNumbers ? `${m.file}:${hit.n}:${hit.text}` : `${m.file}:${hit.text}`)
    }
  }
  return cap(rows)
}
