import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { cannedGenerateResult, stubEngine } from "../atoms/__tests__/_stub.engine.js"
import type { ResearchConfig } from "../researcher.js"

const { runClaudeProcessMock } = vi.hoisted(() => ({ runClaudeProcessMock: vi.fn() }))
vi.mock("../claude-process.js", () => ({ runClaudeProcess: runClaudeProcessMock }))
vi.mock("../../ui/claude-stream-display.js", () => ({
  createStreamDisplay: () => ({ onChunk: () => {}, flush: () => {} }),
  createLegacyStdoutDisplay: () => ({ onStdout: () => {}, flush: () => {} }),
}))
vi.mock("../../ui/spinner.js", () => ({
  startSpinner: () => ({ stop: () => {}, printAbove: () => {} }),
  formatElapsed: () => "1s",
}))
vi.mock("../../ui/transcript.js", () => ({ appendTranscript: () => {} }))
vi.mock("../../ui/output.js", () => ({ printInfo: () => {}, printError: () => {}, printWarn: () => {} }))
vi.mock("../discovery/agent.registry.js", () => ({
  buildAgentRegistry: () => ({
    getContext: () => "research context",
    getGaps: () => null,
    getSpecialists: () => [
      { perspective: "academic", overlay: "ov-a" },
      { perspective: "industry", overlay: "ov-b" },
    ],
    getCorePrompt: () => "RESEARCHER SYSTEM",
  }),
}))

import { runResearchEnsemble } from "../researcher.js"

// Prose report + the agreement-detection skeleton the research stage expects.
const REPORT = '# Report\n\nFindings here.\n\n```json\n{"findings":["f1"],"openQuestions":["q1"]}\n```\n'

describe("runResearchEnsemble — engine transport", () => {
  let tmp: string
  let buildDir: string
  let config: ResearchConfig
  const savedKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ANTHROPIC_API_KEY
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-research-eng-"))
    buildDir = path.join(tmp, "build")
    fs.mkdirSync(buildDir, { recursive: true })
    fs.writeFileSync(path.join(tmp, "settings.json"), JSON.stringify({ provider: "openai" }))
    config = {
      model: "opus",
      ridgelineDir: tmp,
      timeoutMinutes: 30,
      specialistTimeoutSeconds: 180,
      maxBudgetUsd: null,
      buildDir,
      isQuick: false,
      specialistCount: 2,
      networkAllowlist: ["arxiv.org"],
      existingResearchMd: null,
      changelogMd: null,
      iterationNumber: 1,
    }
  })

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = savedKey
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("runs the agenda + specialists on the engine with the WebFetch tool surface", async () => {
    const engine = stubEngine(cannedGenerateResult(REPORT))

    await runResearchEnsemble("# Spec", "# Constraints", null, config, engine)

    expect(runClaudeProcessMock).not.toHaveBeenCalled()
    // agenda + 2 specialists (they agree → synthesis skipped, research.md written directly).
    expect(engine.generate).toHaveBeenCalledTimes(3)

    // Call 0 is the agenda (no tools); calls 1-2 are specialists with WebFetch.
    expect(engine.generate.mock.calls[0]![0].tools ?? []).toHaveLength(0)
    const specialistTools = (engine.generate.mock.calls[1]![0].tools ?? []).map((t) => t.name)
    expect(specialistTools).toContain("WebFetch")
    expect(specialistTools).not.toContain("Bash") // no sandbox here → Bash dropped

    expect(fs.existsSync(path.join(buildDir, "research.md"))).toBe(true)
  })
})
