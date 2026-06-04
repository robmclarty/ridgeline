import * as fs from "node:fs"
import { z } from "zod"
import { defineTool, type ToolFactoryContext } from "./types.js"
import { resolveWithinRoot } from "./path-scope.js"

const DEFAULT_LIMIT = 2000

/**
 * Read a file and return its content as 1-based numbered lines (cat -n style),
 * mirroring the Claude CLI's built-in `Read`. Read-only and scoped to the
 * workspace root, so it needs no sandbox.
 */
export const makeReadTool = (ctx: ToolFactoryContext) =>
  defineTool({
    name: "Read",
    description:
      "Read a file from the workspace. Returns line-numbered content (1-based). " +
      "Use offset (0-based start line) and limit for large files.",
    input_schema: z.object({
      file_path: z.string().describe("Absolute path, or relative to the workspace root."),
      offset: z.number().int().min(0).optional().describe("0-based line index to start from."),
      limit: z.number().int().positive().optional().describe("Maximum number of lines to read."),
    }),
    execute: (input) => {
      const target = resolveWithinRoot(ctx.cwd, input.file_path)
      const lines = fs.readFileSync(target, "utf-8").split("\n")
      const start = input.offset ?? 0
      const slice = lines.slice(start, start + (input.limit ?? DEFAULT_LIMIT))
      if (slice.length === 0) return "(no lines in the requested range)"
      return slice.map((line, i) => `${String(start + i + 1).padStart(6)}\t${line}`).join("\n")
    },
  })
