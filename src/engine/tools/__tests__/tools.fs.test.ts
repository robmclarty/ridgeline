import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { ToolExecContext } from "fascicle"
import { makeReadTool } from "../read.tool.js"
import { makeGlobTool } from "../glob.tool.js"
import { makeGrepTool } from "../grep.tool.js"
import { makeWriteTool } from "../write.tool.js"
import { makeEditTool } from "../edit.tool.js"
import { resolveWithinRoot, resolveWithinRoots } from "../path-scope.js"
import type { ToolFactoryContext } from "../types.js"

const OUTSIDE_ROOT = /outside the allowed workspace root/

const TOOL_CTX: ToolExecContext = {
  abort: new AbortController().signal,
  tool_call_id: "test",
  step_index: 0,
}

const ctxFor = (cwd: string, extra?: Partial<ToolFactoryContext>): ToolFactoryContext => ({
  cwd,
  sandboxProvider: null,
  sandboxMode: "off",
  sandboxExtras: { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
  networkAllowlist: [],
  ...extra,
})

// Mirror fascicle: validate/parse input through the tool's schema (applying
// zod defaults like output_mode) before invoking execute.
const run = async (tool: ReturnType<typeof makeReadTool>, input: unknown): Promise<string> =>
  String(await tool.execute(tool.input_schema.parse(input), TOOL_CTX))

describe("tool surface — filesystem tools", () => {
  let work: string
  const made: string[] = []

  beforeEach(() => {
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-tools-")))
    made.push(work)
  })
  afterEach(() => {
    for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  describe("path-scope", () => {
    it("resolves a nested path within the root", () => {
      fs.mkdirSync(path.join(work, "src"))
      const resolved = resolveWithinRoot(work, "src/a.ts")
      expect(resolved).toBe(path.join(work, "src", "a.ts"))
    })

    it("rejects a `..` traversal escape", () => {
      expect(() => resolveWithinRoot(work, "../escape.txt")).toThrow(OUTSIDE_ROOT)
    })

    it("rejects an absolute path outside the root", () => {
      expect(() => resolveWithinRoot(work, "/etc/passwd")).toThrow(OUTSIDE_ROOT)
    })

    it("rejects a symlink that points outside the root", () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-outside-"))
      made.push(outside)
      fs.symlinkSync(outside, path.join(work, "link"))
      expect(() => resolveWithinRoot(work, "link/secret.txt")).toThrow(OUTSIDE_ROOT)
    })

    it("resolveWithinRoots accepts a path in a secondary root", () => {
      const second = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-second-")))
      made.push(second)
      const resolved = resolveWithinRoots([work, second], path.join(second, "out.md"))
      expect(resolved).toBe(path.join(second, "out.md"))
    })
  })

  describe("Read", () => {
    it("returns 1-based numbered lines", async () => {
      fs.writeFileSync(path.join(work, "f.txt"), "alpha\nbeta\ngamma")
      const out = await run(makeReadTool(ctxFor(work)), { file_path: "f.txt" })
      expect(out).toBe("     1\talpha\n     2\tbeta\n     3\tgamma")
    })

    it("honors offset and limit", async () => {
      fs.writeFileSync(path.join(work, "f.txt"), "a\nb\nc\nd\ne")
      const out = await run(makeReadTool(ctxFor(work)), { file_path: "f.txt", offset: 1, limit: 2 })
      expect(out).toBe("     2\tb\n     3\tc")
    })

    it("denies reads outside the workspace", async () => {
      await expect(run(makeReadTool(ctxFor(work)), { file_path: "../../etc/hosts" })).rejects.toThrow(
        OUTSIDE_ROOT,
      )
    })
  })

  describe("Glob", () => {
    it("matches files and returns absolute paths, newest first", async () => {
      fs.mkdirSync(path.join(work, "src", "sub"), { recursive: true })
      const older = path.join(work, "src", "old.ts")
      const newer = path.join(work, "src", "sub", "new.ts")
      fs.writeFileSync(older, "1")
      fs.writeFileSync(newer, "2")
      fs.writeFileSync(path.join(work, "src", "skip.js"), "3")
      // Force a deterministic mtime ordering: newer is more recent.
      fs.utimesSync(older, new Date(1000), new Date(1000))
      fs.utimesSync(newer, new Date(2000), new Date(2000))
      const out = await run(makeGlobTool(ctxFor(work)), { pattern: "**/*.ts" })
      expect(out).toBe(`${newer}\n${older}`)
    })

    it("returns a clear message when nothing matches", async () => {
      const out = await run(makeGlobTool(ctxFor(work)), { pattern: "**/*.rs" })
      expect(out).toBe("No files matched.")
    })
  })

  describe("Grep", () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(work, "src"))
      fs.writeFileSync(path.join(work, "src", "a.ts"), "const x = 1\nTODO: fix\nconst y = 2")
      fs.writeFileSync(path.join(work, "src", "b.ts"), "all good here")
    })

    it("lists files with matches by default", async () => {
      const out = await run(makeGrepTool(ctxFor(work)), { pattern: "TODO" })
      expect(out).toBe(path.join(work, "src", "a.ts"))
    })

    it("content mode with -n includes file:line:text", async () => {
      const out = await run(makeGrepTool(ctxFor(work)), {
        pattern: "const",
        output_mode: "content",
        "-n": true,
      })
      const file = path.join(work, "src", "a.ts")
      expect(out).toBe(`${file}:1:const x = 1\n${file}:3:const y = 2`)
    })

    it("count mode reports per-file match counts", async () => {
      const out = await run(makeGrepTool(ctxFor(work)), { pattern: "const", output_mode: "count" })
      expect(out).toBe(`${path.join(work, "src", "a.ts")}:2`)
    })

    it("is case-insensitive with -i", async () => {
      const out = await run(makeGrepTool(ctxFor(work)), { pattern: "todo", "-i": true })
      expect(out).toBe(path.join(work, "src", "a.ts"))
    })

    it("respects head_limit", async () => {
      const out = await run(makeGrepTool(ctxFor(work)), {
        pattern: "const",
        output_mode: "content",
        head_limit: 1,
      })
      expect(out.split("\n")).toHaveLength(1)
    })
  })

  describe("Write", () => {
    it("creates parent directories and writes", async () => {
      const out = await run(makeWriteTool(ctxFor(work)), {
        file_path: "nested/deep/out.txt",
        content: "hello",
      })
      expect(fs.readFileSync(path.join(work, "nested/deep/out.txt"), "utf-8")).toBe("hello")
      expect(out).toContain("Wrote 5 bytes")
    })

    it("denies writes outside the workspace", async () => {
      await expect(
        run(makeWriteTool(ctxFor(work)), { file_path: "../evil.txt", content: "x" }),
      ).rejects.toThrow(OUTSIDE_ROOT)
    })

    it("allows writes into an additionalWritePaths root", async () => {
      const buildDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-build-")))
      made.push(buildDir)
      const target = path.join(buildDir, "spec.md")
      await run(makeWriteTool(ctxFor(work, { additionalWritePaths: [buildDir] })), {
        file_path: target,
        content: "spec",
      })
      expect(fs.readFileSync(target, "utf-8")).toBe("spec")
    })
  })

  describe("Edit", () => {
    beforeEach(() => {
      fs.writeFileSync(path.join(work, "f.txt"), "one two one")
    })

    it("replaces a unique occurrence", async () => {
      await run(makeEditTool(ctxFor(work)), { file_path: "f.txt", old_string: "two", new_string: "2" })
      expect(fs.readFileSync(path.join(work, "f.txt"), "utf-8")).toBe("one 2 one")
    })

    it("errors on a non-unique old_string without replace_all", async () => {
      await expect(
        run(makeEditTool(ctxFor(work)), { file_path: "f.txt", old_string: "one", new_string: "1" }),
      ).rejects.toThrow(/not unique/)
    })

    it("replaces all when replace_all is set", async () => {
      await run(makeEditTool(ctxFor(work)), {
        file_path: "f.txt",
        old_string: "one",
        new_string: "1",
        replace_all: true,
      })
      expect(fs.readFileSync(path.join(work, "f.txt"), "utf-8")).toBe("1 two 1")
    })

    it("errors when old_string is absent", async () => {
      await expect(
        run(makeEditTool(ctxFor(work)), { file_path: "f.txt", old_string: "zzz", new_string: "1" }),
      ).rejects.toThrow(/not found/)
    })

    it("errors on empty old_string", async () => {
      await expect(
        run(makeEditTool(ctxFor(work)), { file_path: "f.txt", old_string: "", new_string: "x" }),
      ).rejects.toThrow(/must not be empty/)
    })
  })
})
