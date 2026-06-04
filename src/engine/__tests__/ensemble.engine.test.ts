import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { RidgelineConfig } from "../../types.js"
import { cannedGenerateResult, stubEngine } from "../atoms/__tests__/_stub.engine.js"
import { planArtifactSchema } from "../schemas.js"

const { runClaudeProcessMock } = vi.hoisted(() => ({
  runClaudeProcessMock: vi.fn(),
}))
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
    getContext: () => "",
    getSpecialists: () => [
      { perspective: "incremental", overlay: "ov-a" },
      { perspective: "risk-first", overlay: "ov-b" },
    ],
    getCorePrompt: () => "PLANNER SYSTEM",
  }),
}))

import { runEnsemblePlanner } from "../ensemble.js"

const proposal = (skeleton: { id: string; slug: string }[]) => ({
  perspective: "p",
  summary: "s",
  phases: [
    { title: "P1", slug: "p1", goal: "g", acceptanceCriteria: ["a"], specReference: "spec", rationale: "r" },
  ],
  tradeoffs: "t",
  _skeleton: { phaseList: skeleton, depGraph: [] as string[][] },
})

describe("runEnsemblePlanner — engine transport", () => {
  let tmp: string
  let config: RidgelineConfig
  const savedKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ANTHROPIC_API_KEY
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-ensemble-"))
    const buildDir = path.join(tmp, "build")
    const phasesDir = path.join(buildDir, "phases")
    fs.mkdirSync(phasesDir, { recursive: true })
    fs.writeFileSync(path.join(buildDir, "spec.md"), "# Spec")
    fs.writeFileSync(path.join(tmp, "constraints.md"), "# Constraints")
    // Pre-create a phase file so verify() passes (the stub engine doesn't run the Write tool).
    fs.writeFileSync(path.join(phasesDir, "01-p1.md"), "# Phase 1")
    fs.writeFileSync(path.join(tmp, "settings.json"), JSON.stringify({ provider: "openai" }))
    config = {
      buildName: "test",
      ridgelineDir: tmp,
      buildDir,
      constraintsPath: path.join(tmp, "constraints.md"),
      tastePath: null,
      handoffPath: path.join(buildDir, "handoff.md"),
      phasesDir,
      model: "opus",
      maxRetries: 2,
      timeoutMinutes: 120,
      checkTimeoutSeconds: 1200,
      checkCommand: null,
      maxBudgetUsd: null,
      unsafe: false,
      sandboxMode: "semi-locked",
      sandboxExtras: { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
      networkAllowlist: [],
      extraContext: null,
      specialistCount: 2,
      specialistTimeoutSeconds: 180,
      phaseBudgetLimit: 15,
      phaseTokenLimit: 80000,
      sequencing: { kind: "sequential" },
    }
  })

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = savedKey
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("runs specialists with planArtifactSchema and the synthesizer with the Write tool", async () => {
    const engine = stubEngine<unknown>(cannedGenerateResult<unknown>("synth"))
    engine.generate
      .mockResolvedValueOnce(cannedGenerateResult<unknown>(proposal([{ id: "01-p1", slug: "p1" }])))
      .mockResolvedValueOnce(
        cannedGenerateResult<unknown>(proposal([{ id: "01-p1", slug: "p1" }, { id: "02-p2", slug: "p2" }])),
      )
      .mockResolvedValueOnce(cannedGenerateResult<unknown>("synthesized"))

    await runEnsemblePlanner(config, engine)

    expect(runClaudeProcessMock).not.toHaveBeenCalled()
    // 2 specialists (disagreeing skeletons) + 1 synthesizer.
    expect(engine.generate).toHaveBeenCalledTimes(3)

    const specialistCall = engine.generate.mock.calls[0]![0]
    expect(specialistCall.schema).toBe(planArtifactSchema)
    expect(specialistCall.tools ?? []).toHaveLength(0)

    const synthCall = engine.generate.mock.calls[2]![0]
    expect((synthCall.tools ?? []).map((t) => t.name)).toContain("Write")
    expect(synthCall.schema).toBeUndefined()
  })
})
