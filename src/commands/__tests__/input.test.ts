import { describe, it, expect, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import { resolveInput, resolveInputBundle } from "../input"

const cleanupDirs: string[] = []
afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

const tmp = (): string => {
  const dir = makeTempDir()
  cleanupDirs.push(dir)
  return dir
}

describe("resolveInput", () => {
  it("treats a non-path argument as raw text", () => {
    const result = resolveInput("just some words")
    expect(result.type).toBe("text")
    if (result.type === "text") expect(result.content).toBe("just some words")
  })

  it("reads file content when input points at an existing file", () => {
    const dir = tmp()
    const file = path.join(dir, "spec.md")
    fs.writeFileSync(file, "# Hello\nbody")
    const result = resolveInput(file)
    expect(result.type).toBe("file")
    if (result.type === "file") {
      expect(result.path).toBe(file)
      expect(result.content).toContain("Hello")
    }
  })
})

describe("resolveInputBundle", () => {
  it("returns text when input is plain text and no file matches", () => {
    const result = resolveInputBundle("hello world")
    expect(result.type).toBe("text")
  })

  it("reads single file content", () => {
    const dir = tmp()
    const file = path.join(dir, "studio.md")
    fs.writeFileSync(file, "# Studio\ncontent")
    const result = resolveInputBundle(file)
    expect(result.type).toBe("file")
    if (result.type === "file") expect(result.content).toContain("Studio")
  })

  it("concatenates files in a directory with provenance headers", () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, "a.md"), "alpha body")
    fs.writeFileSync(path.join(dir, "b.md"), "beta body")
    const result = resolveInputBundle(dir)
    expect(result.type).toBe("directory")
    if (result.type === "directory") {
      expect(result.files).toHaveLength(2)
      expect(result.content).toContain("## File: a.md")
      expect(result.content).toContain("alpha body")
      expect(result.content).toContain("## File: b.md")
      expect(result.content).toContain("beta body")
    }
  })

  it("walks subdirectories and skips noisy ones", () => {
    const dir = tmp()
    fs.mkdirSync(path.join(dir, "node_modules"))
    fs.writeFileSync(path.join(dir, "node_modules", "ignored.md"), "ignored")
    fs.mkdirSync(path.join(dir, "deep"))
    fs.writeFileSync(path.join(dir, "deep", "kept.md"), "kept body")
    fs.writeFileSync(path.join(dir, "root.md"), "root body")
    const result = resolveInputBundle(dir)
    expect(result.type).toBe("directory")
    if (result.type === "directory") {
      expect(result.files.some((f) => f.includes("node_modules"))).toBe(false)
      expect(result.content).toContain("kept body")
      expect(result.content).toContain("root body")
      expect(result.content).not.toContain("ignored")
    }
  })

  it("throws when a directory has no readable files", () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, "image.png"), "binary")
    expect(() => resolveInputBundle(dir)).toThrow(/no readable source files/)
  })

  it("includes only .md/.markdown/.txt/.rst files", () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, "a.md"), "md")
    fs.writeFileSync(path.join(dir, "b.markdown"), "markdown")
    fs.writeFileSync(path.join(dir, "c.txt"), "txt")
    fs.writeFileSync(path.join(dir, "d.rst"), "rst")
    fs.writeFileSync(path.join(dir, "e.json"), "{}")
    const result = resolveInputBundle(dir)
    expect(result.type).toBe("directory")
    if (result.type === "directory") {
      expect(result.files).toHaveLength(4)
      expect(result.files.some((f) => f.endsWith(".json"))).toBe(false)
    }
  })
})
