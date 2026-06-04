import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { cannedGenerateResult, stubEngine } from "../atoms/__tests__/_stub.engine.js"
import type { RefineConfig } from "../refiner.js"

const { runClaudeProcessMock } = vi.hoisted(() => ({
  runClaudeProcessMock: vi.fn(async () => ({
    success: true,
    result: "ok",
    durationMs: 3,
    costUsd: 0,
    usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    sessionId: "",
  })),
}))
vi.mock("../claude-process.js", () => ({ runClaudeProcess: runClaudeProcessMock }))
vi.mock("../../ui/claude-stream-display.js", () => ({
  createStreamDisplay: () => ({ onChunk: () => {}, flush: () => {} }),
  createLegacyStdoutDisplay: () => ({ onStdout: () => {}, flush: () => {} }),
}))
vi.mock("../discovery/agent.registry.js", () => ({
  buildAgentRegistry: () => ({ getCorePrompt: () => "REFINER SYSTEM" }),
}))

import { runRefiner } from "../refiner.js"

describe("runRefiner — provider branch", () => {
  let tmp: string
  let buildDir: string
  let config: RefineConfig
  const savedKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ANTHROPIC_API_KEY
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-refine-"))
    buildDir = path.join(tmp, "build")
    fs.mkdirSync(buildDir, { recursive: true })
    // Pre-create the post-condition outputs (the stub engine doesn't run tools).
    fs.writeFileSync(path.join(buildDir, "spec.md"), "spec")
    fs.writeFileSync(path.join(buildDir, "spec.changelog.md"), "changelog")
    config = {
      model: "opus",
      ridgelineDir: tmp,
      timeoutMinutes: 30,
      buildDir,
      changelogMd: null,
      iterationNumber: 1,
    }
  })

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = savedKey
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const setProvider = (provider?: string): void => {
    fs.writeFileSync(path.join(tmp, "settings.json"), JSON.stringify(provider ? { provider } : {}))
  }

  it("routes a non-Claude provider through the engine with the Read/Write tool surface", async () => {
    setProvider("openai")
    const engine = stubEngine(cannedGenerateResult("refined"))

    await runRefiner("spec", "research", "constraints", null, config, engine)

    expect(engine.generate).toHaveBeenCalledTimes(1)
    expect(runClaudeProcessMock).not.toHaveBeenCalled()
    const opts = engine.generate.mock.calls[0]![0]
    expect((opts.tools ?? []).map((t) => t.name)).toEqual(["Read", "Write"])
    expect(opts.max_steps).toBe(8)
  })

  it("routes claude_cli through the byte-stable spawn path", async () => {
    setProvider()
    const engine = stubEngine(cannedGenerateResult("ignored"))

    await runRefiner("spec", "research", "constraints", null, config, engine)

    expect(runClaudeProcessMock).toHaveBeenCalledTimes(1)
    expect(engine.generate).not.toHaveBeenCalled()
  })

  it("enforces the spec.md / spec.changelog.md post-condition on the engine path", async () => {
    setProvider("openai")
    fs.rmSync(path.join(buildDir, "spec.changelog.md"))
    const engine = stubEngine(cannedGenerateResult("refined"))

    await expect(runRefiner("spec", "research", "constraints", null, config, engine)).rejects.toThrow(
      /spec\.changelog\.md/,
    )
  })
})
