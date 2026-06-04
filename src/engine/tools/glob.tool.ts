import * as fs from "node:fs"
import { z } from "zod"
import { defineTool, type ToolFactoryContext } from "./types.js"
import { resolveWithinRoot } from "./path-scope.js"
import { globFilesWithin } from "./fs-scan.js"

const safeMtimeMs = (abs: string): number => {
  try {
    return fs.statSync(abs).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Find files by glob pattern (e.g. `**\/*.ts`), returning absolute paths sorted
 * by modification time (newest first) to match the Claude CLI's built-in `Glob`.
 * Uses Node's built-in `fs.globSync` — no extra dependency. Read-only and scoped
 * to the workspace root.
 */
export const makeGlobTool = (ctx: ToolFactoryContext) =>
  defineTool({
    name: "Glob",
    description:
      "Find files by glob pattern (e.g. **/*.ts or src/**/*.{ts,tsx}). " +
      "Returns absolute paths, newest-modified first.",
    input_schema: z.object({
      pattern: z.string().describe("Glob pattern to match files against."),
      path: z.string().optional().describe("Directory to search; defaults to the workspace root."),
    }),
    execute: (input) => {
      const base = resolveWithinRoot(ctx.cwd, input.path ?? ".")
      const files = globFilesWithin(base, input.pattern)
      if (files.length === 0) return "No files matched."
      return files
        .map((abs) => ({ abs, mtime: safeMtimeMs(abs) }))
        .sort((a, b) => b.mtime - a.mtime)
        .map((f) => f.abs)
        .join("\n")
    },
  })
