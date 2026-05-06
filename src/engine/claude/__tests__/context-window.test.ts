import * as fs from "node:fs"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeTempDir } from "../../../../test/setup"
import {
  DEFAULT_CONTEXT_WINDOWS,
  FALLBACK_CONTEXT_WINDOW,
  resolveContextWindow,
} from "../context-window"

describe("context-window", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("returns the built-in default for known models", () => {
    expect(resolveContextWindow("claude-opus-4-7", tmpDir)).toBe(DEFAULT_CONTEXT_WINDOWS["claude-opus-4-7"])
    expect(resolveContextWindow("opus", tmpDir)).toBe(DEFAULT_CONTEXT_WINDOWS["opus"])
    expect(resolveContextWindow("cli-sonnet", tmpDir)).toBe(DEFAULT_CONTEXT_WINDOWS["cli-sonnet"])
  })

  it("falls back to 200,000 for unknown models", () => {
    expect(FALLBACK_CONTEXT_WINDOW).toBe(200_000)
    expect(resolveContextWindow("gpt-9-future", tmpDir)).toBe(200_000)
  })

  it("settings.json contextWindows override wins over the built-in default", () => {
    fs.writeFileSync(
      path.join(tmpDir, "settings.json"),
      JSON.stringify({ contextWindows: { "claude-sonnet-4-6": 1_000_000 } }),
    )
    expect(resolveContextWindow("claude-sonnet-4-6", tmpDir)).toBe(1_000_000)
  })

  it("settings.json contextWindows override applies to unknown models too", () => {
    fs.writeFileSync(
      path.join(tmpDir, "settings.json"),
      JSON.stringify({ contextWindows: { "local-llama-3-70b": 8_192 } }),
    )
    expect(resolveContextWindow("local-llama-3-70b", tmpDir)).toBe(8_192)
  })

  it("ignores non-positive or non-numeric override values, falling back to default", () => {
    fs.writeFileSync(
      path.join(tmpDir, "settings.json"),
      JSON.stringify({ contextWindows: { "claude-opus-4-7": 0 } }),
    )
    expect(resolveContextWindow("claude-opus-4-7", tmpDir)).toBe(DEFAULT_CONTEXT_WINDOWS["claude-opus-4-7"])
  })

  it("floors fractional override values", () => {
    fs.writeFileSync(
      path.join(tmpDir, "settings.json"),
      JSON.stringify({ contextWindows: { "claude-opus-4-7": 199_999.9 } }),
    )
    expect(resolveContextWindow("claude-opus-4-7", tmpDir)).toBe(199_999)
  })

  it("uses fallback when settings.json does not exist", () => {
    expect(resolveContextWindow("unknown-model", tmpDir)).toBe(FALLBACK_CONTEXT_WINDOW)
  })
})
