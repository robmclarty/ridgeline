import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../../test/setup.js"

vi.mock("../../claude-process.js", () => ({
  runClaudeProcess: vi.fn(),
}))

vi.mock("../../../ui/spinner.js", () => ({
  startSpinner: vi.fn(() => ({
    stop: vi.fn(),
    printAbove: vi.fn(),
  })),
  formatElapsed: vi.fn(() => "1s"),
}))

vi.mock("../../../ui/transcript.js", () => ({
  appendTranscript: vi.fn(),
}))

vi.mock("../../../ui/output.js", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
  printWarn: vi.fn(),
}))

vi.mock("../../../ui/claude-stream-display.js", () => ({
  createLegacyStdoutDisplay: vi.fn(() => ({ onStdout: vi.fn(), flush: vi.fn() })),
}))

import { runClaudeProcess } from "../../claude-process.js"
import { runEnsemble, selectSpecialists, appendSkipAuditNote } from "../../ensemble.js"
import type { SpecialistDef } from "../../discovery/agent.registry.js"
import { printWarn } from "../../../ui/output.js"

const mockClaude = vi.mocked(runClaudeProcess)

const makeSpecialist = (name: string): SpecialistDef => ({
  perspective: name,
  overlay: `${name} overlay`,
})

const makeClaudeResult = (text: string, cost = 0.05) => ({
  success: true,
  result: text,
  durationMs: 1000,
  costUsd: cost,
  usage: { inputTokens: 10, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  sessionId: `sess-${Math.random()}`,
})

describe("selectSpecialists", () => {
  const all: SpecialistDef[] = [
    makeSpecialist("simplicity"),
    makeSpecialist("thoroughness"),
    makeSpecialist("velocity"),
    makeSpecialist("fourth"),
  ]

  it("returns the first 3 specialists by default", () => {
    const selected = selectSpecialists(all, { specialistCount: 3 })
    expect(selected.map((s) => s.perspective)).toEqual(["simplicity", "thoroughness", "velocity"])
  })

  it("can be capped at 2 specialists", () => {
    const selected = selectSpecialists(all, { specialistCount: 2 })
    expect(selected.map((s) => s.perspective)).toEqual(["simplicity", "thoroughness"])
  })

  it("can be capped at 1 specialist", () => {
    const selected = selectSpecialists(all, { specialistCount: 1 })
    expect(selected.map((s) => s.perspective)).toEqual(["simplicity"])
  })

  it("does not mutate the input array", () => {
    selectSpecialists(all, { specialistCount: 2 })
    expect(all.length).toBe(4)
  })

  it("handles undersized specialist lists gracefully", () => {
    const one = [makeSpecialist("only")]
    expect(selectSpecialists(one, { specialistCount: 3 })).toEqual(one)
  })
})

describe("appendSkipAuditNote", () => {
  let tmp: string
  beforeEach(() => { tmp = makeTempDir() })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it("appends the audit line to an existing artifact", () => {
    const fp = path.join(tmp, "spec.md")
    fs.writeFileSync(fp, "# Spec\n\nContent")
    appendSkipAuditNote(fp, 2, "spec")
    const content = fs.readFileSync(fp, "utf-8")
    expect(content).toContain("synthesis skipped: 2 specialists agreed on structured verdict (spec)")
  })

  it("is idempotent", () => {
    const fp = path.join(tmp, "spec.md")
    fs.writeFileSync(fp, "")
    appendSkipAuditNote(fp, 2, "spec")
    appendSkipAuditNote(fp, 2, "spec")
    const matches = fs.readFileSync(fp, "utf-8").match(/synthesis skipped: 2 specialists/g)
    expect(matches?.length).toBe(1)
  })
})

describe("runEnsemble — default 2-specialist", () => {
  beforeEach(() => { mockClaude.mockReset() })

  const buildInvoke = (specialists: SpecialistDef[], overrides: Record<string, unknown> = {}) => ({
    label: "Test",
    specialists,
    buildSpecialistPrompt: (overlay: string) => `system ${overlay}`,
    specialistUserPrompt: "user prompt",
    specialistSchema: "",
    isStructured: false,
    synthesizerPrompt: "synth system",
    buildSynthesizerUserPrompt: (_drafts: { perspective: string; draft: string }[]) => "synth user",
    synthesizerTools: ["Write"],
    model: "opus",
    timeoutMinutes: 10,
    maxBudgetUsd: null,
    ...overrides,
  })

  it("invokes exactly 2 specialists + synthesizer by default", async () => {
    mockClaude.mockImplementation(async () => makeClaudeResult("body"))

    const specialists = [makeSpecialist("a"), makeSpecialist("b")]
    await runEnsemble(buildInvoke(specialists))

    expect(mockClaude).toHaveBeenCalledTimes(3)
  })

  it("continues with a lone survivor when one specialist times out", async () => {
    mockClaude
      .mockImplementationOnce(async () => makeClaudeResult("survivor"))
      .mockImplementationOnce(async () => { throw new Error("Claude invocation timed out") })
      .mockImplementationOnce(async () => makeClaudeResult("synthesized"))

    const specialists = [makeSpecialist("a"), makeSpecialist("b")]
    const result = await runEnsemble(buildInvoke(specialists))

    // 2 specialist calls + 1 synthesizer call = 3
    expect(mockClaude).toHaveBeenCalledTimes(3)
    expect(result.specialistNames).toEqual(["a"])
    expect(printWarn).toHaveBeenCalledWith(expect.stringContaining("Continuing with 1 of 2"))
  })

  it("halts when all specialists fail", async () => {
    mockClaude.mockImplementation(async () => { throw new Error("Claude invocation timed out") })

    const specialists = [makeSpecialist("a"), makeSpecialist("b")]
    await expect(runEnsemble(buildInvoke(specialists))).rejects.toThrow(/all 2 specialists fail/)
  })

  it("logs specialist timeouts to trajectory.jsonl with reason: timeout", async () => {
    const tmp = makeTempDir()
    mockClaude
      .mockImplementationOnce(async () => makeClaudeResult("ok"))
      .mockImplementationOnce(async () => { throw new Error("Claude invocation timed out") })
      .mockImplementationOnce(async () => makeClaudeResult("synth"))

    const specialists = [makeSpecialist("a"), makeSpecialist("b")]
    await runEnsemble(buildInvoke(specialists, { buildDir: tmp }))

    const log = fs.readFileSync(path.join(tmp, "trajectory.jsonl"), "utf-8").trim().split("\n")
    const entries = log.map((line) => JSON.parse(line) as Record<string, unknown>)
    const failEntry = entries.find((e) => e.type === "specialist_fail")
    expect(failEntry).toBeDefined()
    expect(failEntry?.reason).toBe("timeout")
    expect(failEntry?.specialist).toBe("b")

    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("uses specialistTimeoutSeconds (default 600s)", async () => {
    mockClaude.mockImplementation(async () => makeClaudeResult("ok"))

    const specialists = [makeSpecialist("a"), makeSpecialist("b")]
    await runEnsemble(buildInvoke(specialists))

    const firstCall = mockClaude.mock.calls[0][0]
    expect(firstCall.timeoutMs).toBe(600 * 1000)
  })

  it("honors a custom specialistTimeoutSeconds", async () => {
    mockClaude.mockImplementation(async () => makeClaudeResult("ok"))

    const specialists = [makeSpecialist("a"), makeSpecialist("b")]
    await runEnsemble(buildInvoke(specialists, { specialistTimeoutSeconds: 420 }))

    const firstCall = mockClaude.mock.calls[0][0]
    expect(firstCall.timeoutMs).toBe(420 * 1000)
  })
})

describe("runEnsemble — --thorough cross-annotation pass", () => {
  beforeEach(() => { mockClaude.mockReset() })

  const makeConfig = (overrides: Record<string, unknown> = {}) => ({
    label: "Planning",
    specialists: [makeSpecialist("a"), makeSpecialist("b"), makeSpecialist("c")],
    buildSpecialistPrompt: (overlay: string) => `system ${overlay}`,
    specialistUserPrompt: "user prompt",
    specialistSchema: "",
    isStructured: false,
    synthesizerPrompt: "synth",
    buildSynthesizerUserPrompt: () => "synth user",
    synthesizerTools: ["Write"],
    model: "opus",
    timeoutMinutes: 10,
    maxBudgetUsd: null,
    isTwoRound: true,
    buildAnnotationPrompt: (own: string, others: { perspective: string; draft: string }[]) =>
      `own=${own} others=${others.map((o) => o.perspective).sort().join(",")}`,
    ...overrides,
  })

  it("invokes 3 specialists + 3 annotations + 1 synthesizer = 7 calls", async () => {
    mockClaude.mockImplementation(async () => makeClaudeResult("body"))
    await runEnsemble(makeConfig())
    expect(mockClaude).toHaveBeenCalledTimes(7)
  })

  it("round-2 annotation prompt contains the other two specialists' perspectives", async () => {
    mockClaude.mockImplementation(async (opts) => makeClaudeResult(`result-${opts.userPrompt.slice(0, 40)}`))
    await runEnsemble(makeConfig())

    const annotationPrompts = mockClaude.mock.calls
      .map((c) => c[0].userPrompt)
      .filter((p) => p.startsWith("own="))

    expect(annotationPrompts).toHaveLength(3)
    const byOwner = new Map(annotationPrompts.map((p) => {
      const m = p.match(/own=(\w+) others=([\w,]+)/)
      return [m![1], m![2]] as const
    }))
    expect(byOwner.get("a")).toBe("b,c")
    expect(byOwner.get("b")).toBe("a,c")
    expect(byOwner.get("c")).toBe("a,b")
  })
})

describe("runEnsemble — agreement-based synthesis skip", () => {
  beforeEach(() => { mockClaude.mockReset() })

  const buildConfig = (overrides: Record<string, unknown>) => ({
    label: "Specifying",
    specialists: [makeSpecialist("a"), makeSpecialist("b")],
    buildSpecialistPrompt: (overlay: string) => `system ${overlay}`,
    specialistUserPrompt: "user prompt",
    specialistSchema: "",
    isStructured: false,
    synthesizerPrompt: "synth",
    buildSynthesizerUserPrompt: () => "synth user",
    synthesizerTools: ["Write"],
    model: "opus",
    timeoutMinutes: 10,
    maxBudgetUsd: null,
    stage: "spec" as const,
    ...overrides,
  })

  it("skips synthesizer when skeletons agree", async () => {
    const skeleton = { sectionOutline: ["auth", "profiles"], riskList: ["latency"] }
    const raw = `# Report\n\n\`\`\`json\n${JSON.stringify(skeleton)}\n\`\`\`\n`
    mockClaude
      .mockImplementationOnce(async () => makeClaudeResult(raw))
      .mockImplementationOnce(async () => makeClaudeResult(raw))

    const onAgreementSkip = vi.fn(async () => makeClaudeResult("skip-synthesis", 0))

    await runEnsemble(buildConfig({ onAgreementSkip }))

    expect(mockClaude).toHaveBeenCalledTimes(2)
    expect(onAgreementSkip).toHaveBeenCalledTimes(1)
  })

  it("runs synthesizer when skeletons disagree", async () => {
    const a = { sectionOutline: ["auth"], riskList: ["latency"] }
    const b = { sectionOutline: ["auth", "profiles"], riskList: ["latency"] }
    mockClaude
      .mockImplementationOnce(async () => makeClaudeResult(`\`\`\`json\n${JSON.stringify(a)}\n\`\`\``))
      .mockImplementationOnce(async () => makeClaudeResult(`\`\`\`json\n${JSON.stringify(b)}\n\`\`\``))
      .mockImplementationOnce(async () => makeClaudeResult("synthesis"))

    const onAgreementSkip = vi.fn()

    await runEnsemble(buildConfig({ onAgreementSkip }))

    expect(mockClaude).toHaveBeenCalledTimes(3)
    expect(onAgreementSkip).not.toHaveBeenCalled()
  })

  it("runs synthesizer with warning when a skeleton is malformed", async () => {
    const ok = { sectionOutline: ["x"], riskList: ["y"] }
    mockClaude
      .mockImplementationOnce(async () => makeClaudeResult(`\`\`\`json\n${JSON.stringify(ok)}\n\`\`\``))
      .mockImplementationOnce(async () => makeClaudeResult("no json block in this specialist output"))
      .mockImplementationOnce(async () => makeClaudeResult("synthesis"))

    const onAgreementSkip = vi.fn()

    await runEnsemble(buildConfig({ onAgreementSkip }))

    expect(mockClaude).toHaveBeenCalledTimes(3)
    expect(printWarn).toHaveBeenCalledWith(expect.stringMatching(/did not parse/))
    expect(onAgreementSkip).not.toHaveBeenCalled()
  })

  it("three-way agreement under --thorough skips synthesizer", async () => {
    const skeleton = { sectionOutline: ["auth"], riskList: ["latency"] }
    const raw = `\`\`\`json\n${JSON.stringify(skeleton)}\n\`\`\``

    // 3 specialists + 3 annotations (thorough mode); NO synthesizer when agreement.
    mockClaude.mockImplementation(async () => makeClaudeResult(raw))

    const onAgreementSkip = vi.fn(async () => makeClaudeResult("first-draft", 0))

    await runEnsemble(
      buildConfig({
        specialists: [makeSpecialist("a"), makeSpecialist("b"), makeSpecialist("c")],
        isTwoRound: true,
        buildAnnotationPrompt: () => "annotation prompt",
        onAgreementSkip,
      }),
    )

    // 3 specialists + 3 annotations = 6; synthesizer skipped
    expect(mockClaude).toHaveBeenCalledTimes(6)
    expect(onAgreementSkip).toHaveBeenCalledTimes(1)
  })

  it("logs a synthesis_skipped trajectory entry when synthesis is skipped", async () => {
    const tmp = makeTempDir()
    const skeleton = { sectionOutline: ["auth"], riskList: ["latency"] }
    const raw = `\`\`\`json\n${JSON.stringify(skeleton)}\n\`\`\``
    mockClaude.mockImplementation(async () => makeClaudeResult(raw))

    const onAgreementSkip = vi.fn(async () => makeClaudeResult("first", 0))

    await runEnsemble(buildConfig({ onAgreementSkip, buildDir: tmp }))

    const log = fs.readFileSync(path.join(tmp, "trajectory.jsonl"), "utf-8").trim().split("\n")
    const entries = log.map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(entries.some((e) => e.type === "synthesis_skipped" && e.stage === "spec")).toBe(true)

    fs.rmSync(tmp, { recursive: true, force: true })
  })
})
