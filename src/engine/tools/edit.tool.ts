import * as fs from "node:fs"
import { z } from "zod"
import { defineTool, type ToolFactoryContext } from "./types.js"
import { resolveWithinRoots } from "./path-scope.js"
import { writableRoots } from "./write.tool.js"

const countOccurrences = (haystack: string, needle: string): number =>
  needle.length === 0 ? 0 : haystack.split(needle).length - 1

/**
 * Exact-string replacement in a workspace file, reproducing the Claude CLI
 * built-in `Edit` contract precisely so models trained against it behave
 * identically: `old_string` must be found, and must be UNIQUE unless
 * `replace_all` is set; mismatches throw a descriptive error (which, under
 * `tool_error_policy: "feed_back"`, is returned to the model to self-correct).
 */
export const makeEditTool = (ctx: ToolFactoryContext) =>
  defineTool({
    name: "Edit",
    description:
      "Replace an exact string in a workspace file. old_string must match exactly and be unique " +
      "unless replace_all is true. Use Read first to get exact surrounding context.",
    input_schema: z.object({
      file_path: z.string().describe("Absolute path, or relative to the workspace root."),
      old_string: z.string().describe("Exact text to replace."),
      new_string: z.string().describe("Replacement text (must differ from old_string)."),
      replace_all: z.boolean().default(false),
    }),
    execute: (input) => {
      if (input.old_string.length === 0) throw new Error("old_string must not be empty.")
      if (input.old_string === input.new_string) {
        throw new Error("old_string and new_string are identical; nothing to change.")
      }
      const target = resolveWithinRoots(writableRoots(ctx), input.file_path)
      const src = fs.readFileSync(target, "utf-8")
      const count = countOccurrences(src, input.old_string)
      if (count === 0) throw new Error("old_string not found in file.")
      if (!input.replace_all && count > 1) {
        throw new Error(
          `old_string is not unique (${count} matches); add surrounding context or set replace_all.`,
        )
      }
      const updated = input.replace_all
        ? src.split(input.old_string).join(input.new_string)
        : src.replace(input.old_string, input.new_string)
      fs.writeFileSync(target, updated)
      return input.replace_all ? `Replaced ${count} occurrence(s) in ${target}` : `Edited ${target}`
    },
  })
