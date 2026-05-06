import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import { slugify, resolveNameAndInput, parseAutoCount } from "../cli-args"

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("My Cool Build")).toBe("my-cool-build")
  })

  it("strips a single trailing extension", () => {
    expect(slugify("idea.md")).toBe("idea")
    expect(slugify("My Idea.MARKDOWN")).toBe("my-idea")
  })

  it("collapses runs of non-alphanumerics to a single hyphen", () => {
    // No trailing extension to strip — runs of `_` and ` ` collapse.
    expect(slugify("foo___ bar  baz")).toBe("foo-bar-baz")
  })

  it("trims leading and trailing hyphens", () => {
    expect(slugify("--hello world--")).toBe("hello-world")
  })

  it("returns an empty string when nothing is alphanumeric", () => {
    expect(slugify("___")).toBe("")
    expect(slugify(".md")).toBe("")
  })

  it("strips only the last extension (preserves earlier dots-as-hyphens)", () => {
    // "v1.2.spec" → ".spec" stripped → "v1.2" → "v1-2"
    expect(slugify("v1.2.spec")).toBe("v1-2")
  })
})

describe("resolveNameAndInput", () => {
  let origCwd: string
  let tmpDir: string

  beforeEach(() => {
    origCwd = process.cwd()
    tmpDir = makeTempDir()
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("returns both args when explicitly given two", () => {
    expect(resolveNameAndInput("my-build", "./spec.md")).toEqual({
      buildName: "my-build",
      input: "./spec.md",
    })
  })

  it("derives slugified build name from arg1 when arg1 is an existing file", () => {
    const filePath = path.join(tmpDir, "Cool Idea.md")
    fs.writeFileSync(filePath, "x")
    expect(resolveNameAndInput(filePath, undefined)).toEqual({
      buildName: "cool-idea",
      input: filePath,
    })
  })

  it("derives build name from an existing directory's basename", () => {
    const dirPath = path.join(tmpDir, "Big Project")
    fs.mkdirSync(dirPath)
    expect(resolveNameAndInput(dirPath, undefined)).toEqual({
      buildName: "big-project",
      input: dirPath,
    })
  })

  it("treats arg1 as a build name when it is not an existing path", () => {
    expect(resolveNameAndInput("not-a-real-path", undefined)).toEqual({
      buildName: "not-a-real-path",
      input: undefined,
    })
  })

  it("returns both undefined when no args are given", () => {
    expect(resolveNameAndInput(undefined, undefined)).toEqual({
      buildName: undefined,
      input: undefined,
    })
  })

  it("when arg1 is a path AND arg2 is provided, treats them explicitly (arg1 = name, arg2 = input)", () => {
    const filePath = path.join(tmpDir, "idea.md")
    fs.writeFileSync(filePath, "x")
    // Two args wins over the derived form: caller has been explicit.
    expect(resolveNameAndInput(filePath, "./other.md")).toEqual({
      buildName: filePath,
      input: "./other.md",
    })
  })
})

describe("parseAutoCount", () => {
  it("returns undefined when raw is undefined (flag not passed)", () => {
    expect(parseAutoCount(undefined, 3)).toBeUndefined()
  })

  it("returns the default when raw is true (flag passed without value)", () => {
    expect(parseAutoCount(true, 3)).toBe(3)
    expect(parseAutoCount(true, 1)).toBe(1)
  })

  it("returns the parsed integer when raw is a numeric string", () => {
    expect(parseAutoCount("5", 3)).toBe(5)
    expect(parseAutoCount("1", 3)).toBe(1)
  })

  it("returns the default when the string is not numeric", () => {
    expect(parseAutoCount("foo", 3)).toBe(3)
  })

  it("returns the default when the parsed value is less than 1", () => {
    expect(parseAutoCount("0", 3)).toBe(3)
    expect(parseAutoCount("-2", 3)).toBe(3)
  })
})
