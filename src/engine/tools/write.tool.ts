import * as fs from "node:fs"
import * as path from "node:path"
import { z } from "zod"
import { defineTool, type ToolFactoryContext } from "./types.js"
import { resolveWithinRoots } from "./path-scope.js"

/** The roots a mutation tool may write to: the workspace cwd plus any extras. */
export const writableRoots = (ctx: ToolFactoryContext): string[] => [
  ctx.cwd,
  ...(ctx.additionalWritePaths ?? []),
]

/**
 * Create or overwrite a file in the workspace, creating parent directories as
 * needed. Scoped to the cwd and any `additionalWritePaths` (e.g. a buildDir
 * outside the cwd); a path escaping those roots throws `PathScopeError`.
 */
export const makeWriteTool = (ctx: ToolFactoryContext) =>
  defineTool({
    name: "Write",
    description:
      "Write (create or overwrite) a file in the workspace. Parent directories are created automatically.",
    input_schema: z.object({
      file_path: z.string().describe("Absolute path, or relative to the workspace root."),
      content: z.string(),
    }),
    execute: (input) => {
      const target = resolveWithinRoots(writableRoots(ctx), input.file_path)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, input.content)
      return `Wrote ${Buffer.byteLength(input.content)} bytes to ${target}`
    },
  })
