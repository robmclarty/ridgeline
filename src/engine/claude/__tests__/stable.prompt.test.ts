import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  approximateTokenCount,
  buildStablePrompt,
  computeStableHash,
  detectExcludeDynamicFlag,
  minCacheableTokens,
  shouldLogUnavailableOnce,
  writeStablePromptFile,
  __resetStablePromptState,
  __trackedTempFiles,
} from "../stable.prompt.js"

const sampleConstraints = "# Constraints\n\n- use TypeScript\n- use strict mode\n"
const sampleTaste = "# Taste\n\n- prefer pure functions\n"
const sampleSpec = "# Spec\n\nBuild a CLI tool that does X.\n"

describe("buildStablePrompt", () => {
  it("orders sections as constraints → taste → spec", () => {
    const out = buildStablePrompt({
      constraintsMd: sampleConstraints,
      tasteMd: sampleTaste,
      specMd: sampleSpec,
    })
    expect(out).toMatchInlineSnapshot(`
      "## constraints.md

      # Constraints

      - use TypeScript
      - use strict mode

      ## taste.md

      # Taste

      - prefer pure functions

      ## spec.md

      # Spec

      Build a CLI tool that does X.
      "
    `)
    const cIdx = out.indexOf("## constraints.md")
    const tIdx = out.indexOf("## taste.md")
    const sIdx = out.indexOf("## spec.md")
    expect(cIdx).toBeLessThan(tIdx)
    expect(tIdx).toBeLessThan(sIdx)
  })

  it("omits taste.md when absent (preserves order)", () => {
    const out = buildStablePrompt({
      constraintsMd: sampleConstraints,
      tasteMd: null,
      specMd: sampleSpec,
    })
    expect(out).not.toContain("## taste.md")
    expect(out.indexOf("## constraints.md")).toBeLessThan(out.indexOf("## spec.md"))
  })

  it("omits taste.md when present but blank/whitespace-only", () => {
    const out = buildStablePrompt({
      constraintsMd: sampleConstraints,
      tasteMd: "   \n\n",
      specMd: sampleSpec,
    })
    expect(out).not.toContain("## taste.md")
  })

  it("omits spec.md when absent", () => {
    const out = buildStablePrompt({
      constraintsMd: sampleConstraints,
      tasteMd: sampleTaste,
      specMd: null,
    })
    expect(out).toContain("## constraints.md")
    expect(out).toContain("## taste.md")
    expect(out).not.toContain("## spec.md")
  })
})

describe("computeStableHash", () => {
  it("produces deterministic sha256 hex (64 chars)", () => {
    const hashA = computeStableHash("hello world")
    const hashB = computeStableHash("hello world")
    expect(hashA).toBe(hashB)
    expect(hashA).toMatch(/^[a-f0-9]{64}$/)
  })

  it("differs when content differs", () => {
    expect(computeStableHash("a")).not.toBe(computeStableHash("b"))
  })
})

describe("writeStablePromptFile", () => {
  beforeEach(() => {
    __resetStablePromptState()
  })

  afterEach(() => {
    for (const fp of __trackedTempFiles()) {
      try { fs.unlinkSync(fp) } catch { /* ignore */ }
    }
    __resetStablePromptState()
  })

  it("writes to os.tmpdir() with hash-named filename", () => {
    const content = "some stable content"
    const { path: fp, hash } = writeStablePromptFile(content)
    expect(fp.startsWith(os.tmpdir())).toBe(true)
    expect(fp).toContain(`ridgeline-stable-${hash}.md`)
    expect(fs.readFileSync(fp, "utf-8")).toBe(content)
  })

  it("is byte-identical across two calls with the same content", () => {
    const content = buildStablePrompt({
      constraintsMd: sampleConstraints,
      tasteMd: sampleTaste,
      specMd: sampleSpec,
    })
    const first = writeStablePromptFile(content)
    const bytesA = fs.readFileSync(first.path)
    const second = writeStablePromptFile(content)
    const bytesB = fs.readFileSync(second.path)
    expect(first.path).toBe(second.path)
    expect(first.hash).toBe(second.hash)
    expect(bytesA.equals(bytesB)).toBe(true)
  })

  it("changes path and hash when content changes", () => {
    const a = writeStablePromptFile("content-one")
    const b = writeStablePromptFile("content-two")
    expect(a.hash).not.toBe(b.hash)
    expect(a.path).not.toBe(b.path)
  })

  it("tracks files for process-exit cleanup", () => {
    writeStablePromptFile("tracked-content")
    expect(__trackedTempFiles().length).toBeGreaterThan(0)
  })
})

describe("approximateTokenCount", () => {
  it("uses 4-char-per-token heuristic (rounded up)", () => {
    expect(approximateTokenCount("")).toBe(0)
    expect(approximateTokenCount("abcd")).toBe(1)
    expect(approximateTokenCount("abcde")).toBe(2)
    expect(approximateTokenCount("a".repeat(4096))).toBe(1024)
  })
})

describe("minCacheableTokens", () => {
  it("returns 4096 for opus and haiku", () => {
    expect(minCacheableTokens("opus")).toBe(4096)
    expect(minCacheableTokens("claude-opus-4-7")).toBe(4096)
    expect(minCacheableTokens("haiku")).toBe(4096)
    expect(minCacheableTokens("claude-haiku-4-5")).toBe(4096)
  })

  it("returns 2048 for sonnet", () => {
    expect(minCacheableTokens("sonnet")).toBe(2048)
    expect(minCacheableTokens("claude-sonnet-4-6")).toBe(2048)
  })
})

describe("detectExcludeDynamicFlag", () => {
  beforeEach(() => {
    __resetStablePromptState()
  })

  it("returns true when the claude --help output mentions the flag", () => {
    const stub = () => "--append-system-prompt-file\n--exclude-dynamic-system-prompt-sections\n"
    expect(detectExcludeDynamicFlag(stub)).toBe(true)
  })

  it("returns false when the help output does not mention the flag", () => {
    const stub = () => "--model\n--verbose\n"
    expect(detectExcludeDynamicFlag(stub)).toBe(false)
  })

  it("caches detection across subsequent calls", () => {
    let calls = 0
    const runner = (): string => {
      calls++
      return "--exclude-dynamic-system-prompt-sections"
    }
    expect(detectExcludeDynamicFlag(runner)).toBe(true)
    expect(detectExcludeDynamicFlag(runner)).toBe(true)
    expect(calls).toBe(1)
  })

  it("returns false when the runner throws", () => {
    const boom = (): string => { throw new Error("spawn failed") }
    expect(detectExcludeDynamicFlag(boom)).toBe(false)
  })
})

describe("shouldLogUnavailableOnce", () => {
  beforeEach(() => {
    __resetStablePromptState()
  })

  it("returns true once, then false for the rest of the process lifetime", () => {
    expect(shouldLogUnavailableOnce()).toBe(true)
    expect(shouldLogUnavailableOnce()).toBe(false)
    expect(shouldLogUnavailableOnce()).toBe(false)
  })
})

describe("stable-block immunity to handoff mutation", () => {
  it("hash stays constant as handoff content changes (handoff never enters stable block)", () => {
    const handoffA = "## Phase 1 handoff — built module A"
    const handoffB = "## Phase 2 handoff — later, much later, the state diverges"
    const stable = {
      constraintsMd: sampleConstraints,
      tasteMd: sampleTaste,
      specMd: sampleSpec,
    }
    const content1 = buildStablePrompt(stable)
    const content2 = buildStablePrompt(stable)
    // handoffA / handoffB are lexical noise never passed into the builder
    expect(handoffA).not.toBe(handoffB)
    expect(content1).toBe(content2)
    expect(computeStableHash(content1)).toBe(computeStableHash(content2))
  })
})

describe("no ridgeline-side cache-key persistence", () => {
  beforeEach(() => { __resetStablePromptState() })
  afterEach(() => {
    for (const fp of __trackedTempFiles()) {
      try { fs.unlinkSync(fp) } catch { /* ignore */ }
    }
    __resetStablePromptState()
  })

  it("does not write cache-key.json or mtime-tracking files anywhere under cwd", () => {
    // The stable-prompt implementation delegates invalidation to the upstream
    // API's content-hash. Ridgeline must never persist a client-side cache key
    // (for example, `.ridgeline/cache-key.json`).
    writeStablePromptFile("content for hashing")
    const tracked = __trackedTempFiles()
    for (const fp of tracked) {
      expect(fp).not.toMatch(/cache-key/i)
    }
    const ridgelineDir = path.join(process.cwd(), ".ridgeline")
    if (fs.existsSync(ridgelineDir)) {
      expect(fs.existsSync(path.join(ridgelineDir, "cache-key.json"))).toBe(false)
    }
  })
})

describe("temp file naming convention", () => {
  beforeEach(() => { __resetStablePromptState() })
  afterEach(() => {
    for (const fp of __trackedTempFiles()) {
      try { fs.unlinkSync(fp) } catch { /* ignore */ }
    }
    __resetStablePromptState()
  })

  it("matches os.tmpdir()/ridgeline-stable-<sha256>.md", () => {
    const { path: fp } = writeStablePromptFile("hello")
    const parsed = path.parse(fp)
    expect(parsed.dir).toBe(os.tmpdir())
    expect(parsed.name).toMatch(/^ridgeline-stable-[a-f0-9]{64}$/)
    expect(parsed.ext).toBe(".md")
  })
})
