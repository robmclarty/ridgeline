import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { resolveRoute } from "../provider-route.js"

const makeRidgelineDir = (settings?: Record<string, unknown>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-route-"))
  if (settings) {
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings))
  }
  return dir
}

describe("resolveRoute", () => {
  const savedKey = process.env.ANTHROPIC_API_KEY
  const dirs: string[] = []

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = savedKey
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  const ridgelineDir = (settings?: Record<string, unknown>): string => {
    const dir = makeRidgelineDir(settings)
    dirs.push(dir)
    return dir
  }

  it("routes a known provider colon-form to that provider and strips the prefix", () => {
    expect(resolveRoute("openai:gpt-4o", ridgelineDir())).toEqual({
      provider: "openai",
      modelId: "gpt-4o",
      isClaudeCli: false,
    })
  })

  it("preserves openrouter `provider/model` slugs after the first colon", () => {
    expect(resolveRoute("openrouter:google/gemini-2.5-pro", ridgelineDir())).toEqual({
      provider: "openrouter",
      modelId: "google/gemini-2.5-pro",
      isClaudeCli: false,
    })
  })

  it("treats the AI-SDK anthropic provider as NOT claude_cli (engine path)", () => {
    expect(resolveRoute("anthropic:claude-opus-4-8", ridgelineDir())).toEqual({
      provider: "anthropic",
      modelId: "claude-opus-4-8",
      isClaudeCli: false,
    })
  })

  it("flags an explicit claude_cli colon-form as claude_cli (spawn path)", () => {
    expect(resolveRoute("claude_cli:opus", ridgelineDir())).toEqual({
      provider: "claude_cli",
      modelId: "opus",
      isClaudeCli: true,
    })
  })

  it("ignores an unknown colon prefix and falls through to the default provider", () => {
    // "foo" is not a known provider, so fascicle keeps the whole string as the id.
    expect(resolveRoute("foo:bar", ridgelineDir())).toEqual({
      provider: "claude_cli",
      modelId: "foo:bar",
      isClaudeCli: true,
    })
  })

  it("uses the settings `provider` default for a bare family", () => {
    expect(resolveRoute("opus", ridgelineDir({ provider: "google" }))).toEqual({
      provider: "google",
      modelId: "opus",
      isClaudeCli: false,
    })
  })

  it("defaults a bare family to anthropic when ANTHROPIC_API_KEY is set and no settings provider", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test"
    expect(resolveRoute("opus", ridgelineDir())).toEqual({
      provider: "anthropic",
      modelId: "opus",
      isClaudeCli: false,
    })
  })

  it("defaults a bare family to claude_cli when no key and no settings provider", () => {
    expect(resolveRoute("opus", ridgelineDir())).toEqual({
      provider: "claude_cli",
      modelId: "opus",
      isClaudeCli: true,
    })
  })

  it("lets an explicit colon-form override the settings default", () => {
    expect(resolveRoute("openai:gpt-4o", ridgelineDir({ provider: "google" }))).toEqual({
      provider: "openai",
      modelId: "gpt-4o",
      isClaudeCli: false,
    })
  })
})
