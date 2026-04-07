import { describe, it, expect, vi, beforeEach } from "vitest"
import { makeConfig, makeClaudeResult, makePhase } from "../../../../test/factories"

vi.mock("../../claude/claude.exec", () => ({
  invokeClaude: vi.fn(),
}))

vi.mock("../../discovery/agent.registry", () => ({
  buildAgentRegistry: vi.fn(() => ({
    getCorePrompt: vi.fn(() => "synthesizer prompt"),
    getSpecialists: vi.fn(() => [
      { perspective: "speed", overlay: "Build fast" },
      { perspective: "quality", overlay: "Build well" },
    ]),
    getContext: vi.fn(() => "planner context content"),
    getSubAgents: vi.fn(() => []),
    getAgentsFlag: vi.fn(() => ({})),
  })),
}))

vi.mock("../../discovery/flavour.resolve", () => ({
  resolveFlavour: vi.fn(() => null),
}))

vi.mock("../../claude/stream.decode", () => ({
  createDisplayCallbacks: vi.fn(() => ({ onStdout: vi.fn(), flush: vi.fn() })),
}))

vi.mock("../../../store/phases", () => ({
  scanPhases: vi.fn(() => []),
}))


vi.mock("../../../ui/output", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
}))

vi.mock("../../../ui/spinner", () => ({
  startSpinner: vi.fn(() => ({ printAbove: vi.fn(), stop: vi.fn() })),
  formatElapsed: vi.fn(() => "5s"),
}))

vi.mock("../plan.exec", () => ({
  assembleBaseUserPrompt: vi.fn(() => "base user prompt"),
}))

vi.mock("../pipeline.shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pipeline.shared")>()
  return {
    ...actual,
    createStderrHandler: vi.fn(() => vi.fn()),
  }
})

import { invokeEnsemble, invokePlanner, extractJSON } from "../ensemble.exec"
import { invokeClaude } from "../../claude/claude.exec"
import { scanPhases } from "../../../store/phases"
import { printError } from "../../../ui/output"

const makeProposal = (perspective = "speed") => JSON.stringify({
  perspective,
  summary: "Build it fast",
  phases: [
    {
      title: "Scaffold",
      slug: "scaffold",
      goal: "Set up the project",
      acceptanceCriteria: ["Project compiles"],
      specReference: "Section 1",
      rationale: "Foundation first",
    },
  ],
  tradeoffs: "Less thorough",
})

beforeEach(() => vi.clearAllMocks())

describe("extractJSON", () => {
  const obj = { perspective: "speed", summary: "Go fast" }

  it("parses plain JSON", () => {
    expect(extractJSON(JSON.stringify(obj))).toEqual(obj)
  })

  it("strips markdown json fence", () => {
    expect(extractJSON("```json\n" + JSON.stringify(obj) + "\n```")).toEqual(obj)
  })

  it("strips plain markdown fence", () => {
    expect(extractJSON("```\n" + JSON.stringify(obj) + "\n```")).toEqual(obj)
  })

  it("extracts JSON embedded in surrounding text", () => {
    const wrapped = "Here is the plan:\n" + JSON.stringify(obj) + "\nLet me know if you need changes."
    expect(extractJSON(wrapped)).toEqual(obj)
  })

  it("handles whitespace around JSON", () => {
    expect(extractJSON("  \n" + JSON.stringify(obj) + "\n  ")).toEqual(obj)
  })

  it("throws when no JSON found", () => {
    expect(() => extractJSON("no json here")).toThrow("No valid JSON object found")
  })
})

describe("invokeEnsemble", () => {
  const makeSimpleDraft = () => JSON.stringify({ value: "test" })

  const makeEnsembleConfig = (overrides: Record<string, unknown> = {}) => ({
    label: "Testing",
    specialists: (overrides.specialists as { perspective: string; overlay: string }[]) ?? [
      { perspective: "speed", overlay: "Build fast" },
      { perspective: "quality", overlay: "Build well" },
    ],
    buildSpecialistPrompt: (overlay: string) => `system: ${overlay}`,
    specialistUserPrompt: "user prompt",
    specialistSchema: JSON.stringify({ type: "object" }),
    synthesizerPrompt: "synth prompt",
    buildSynthesizerUserPrompt: () => "synth user prompt",
    synthesizerTools: ["Write"],
    model: "opus",
    timeoutMinutes: 10,
    maxBudgetUsd: null,
    ...overrides,
  })

  it("throws when no specialists are provided", async () => {
    await expect(
      invokeEnsemble(makeEnsembleConfig({ specialists: [] })),
    ).rejects.toThrow("No specialist agents found")
  })

  it("spawns each specialist in parallel", async () => {
    const specialistResult = makeClaudeResult({ result: makeSimpleDraft() })
    const synthResult = makeClaudeResult({ result: "synthesized" })

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(specialistResult)
      .mockResolvedValueOnce(specialistResult)
      .mockResolvedValueOnce(synthResult)

    await invokeEnsemble(makeEnsembleConfig())

    // 2 specialist calls + 1 synthesizer call
    expect(invokeClaude).toHaveBeenCalledTimes(3)
  })

  it("handles partial specialist failures", async () => {
    const specialistResult = makeClaudeResult({ result: makeSimpleDraft() })
    const synthResult = makeClaudeResult({ result: "synthesized" })

    vi.mocked(invokeClaude)
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce(specialistResult)
      .mockResolvedValueOnce(synthResult)

    // 2 agents, ceil(2/2)=1, so 1 success is enough
    await invokeEnsemble(makeEnsembleConfig())

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("Specialist failed"))
  })

  it("handles unparseable specialist JSON", async () => {
    const badResult = makeClaudeResult({ result: "not json" })
    const goodResult = makeClaudeResult({ result: makeSimpleDraft() })
    const synthResult = makeClaudeResult({ result: "synthesized" })

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(badResult)
      .mockResolvedValueOnce(goodResult)
      .mockResolvedValueOnce(synthResult)

    await invokeEnsemble(makeEnsembleConfig())

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("Failed to parse"))
  })

  it("throws when fewer than half of specialists succeed", async () => {
    const threeSpecialists = [
      { perspective: "a", overlay: "A" },
      { perspective: "b", overlay: "B" },
      { perspective: "c", overlay: "C" },
    ]

    vi.mocked(invokeClaude)
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockRejectedValueOnce(new Error("fail 3"))

    await expect(
      invokeEnsemble(makeEnsembleConfig({ specialists: threeSpecialists })),
    ).rejects.toThrow(/requires at least 2 of 3/)
  })

  it("throws when specialist cost exceeds budget", async () => {
    const oneSpecialist = [{ perspective: "speed", overlay: "Build fast" }]

    vi.mocked(invokeClaude).mockResolvedValueOnce(
      makeClaudeResult({ result: makeSimpleDraft(), costUsd: 5.00 }),
    )

    await expect(
      invokeEnsemble(makeEnsembleConfig({ specialists: oneSpecialist, maxBudgetUsd: 1.00 })),
    ).rejects.toThrow(/Specialist cost.*exceeds budget/)
  })

  it("calls verify callback after synthesis", async () => {
    const oneSpecialist = [{ perspective: "speed", overlay: "Build fast" }]

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(makeClaudeResult({ result: makeSimpleDraft() }))
      .mockResolvedValueOnce(makeClaudeResult({ result: "synthesized" }))

    const verify = vi.fn()
    await invokeEnsemble(makeEnsembleConfig({ specialists: oneSpecialist, verify }))

    expect(verify).toHaveBeenCalledTimes(1)
  })

  it("throws when verify fails", async () => {
    const oneSpecialist = [{ perspective: "speed", overlay: "Build fast" }]

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(makeClaudeResult({ result: makeSimpleDraft() }))
      .mockResolvedValueOnce(makeClaudeResult({ result: "synthesized" }))

    await expect(
      invokeEnsemble(makeEnsembleConfig({
        specialists: oneSpecialist,
        verify: () => { throw new Error("Verification failed") },
      })),
    ).rejects.toThrow("Verification failed")
  })

  it("aggregates costs and durations correctly", async () => {
    const spec1 = makeClaudeResult({ result: makeSimpleDraft(), costUsd: 0.10, durationMs: 3000 })
    const spec2 = makeClaudeResult({ result: makeSimpleDraft(), costUsd: 0.15, durationMs: 5000 })
    const synth = makeClaudeResult({ result: "done", costUsd: 0.20, durationMs: 2000 })

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(spec1)
      .mockResolvedValueOnce(spec2)
      .mockResolvedValueOnce(synth)

    const result = await invokeEnsemble(makeEnsembleConfig())

    expect(result.totalCostUsd).toBeCloseTo(0.45)
    expect(result.totalDurationMs).toBe(5000 + 2000) // max specialist + synth
    expect(result.specialistResults).toHaveLength(2)
    expect(result.synthesizerResult).toBe(synth)
  })

  it("passes drafts to buildSynthesizerUserPrompt", async () => {
    const oneSpecialist = [{ perspective: "speed", overlay: "Build fast" }]
    const draft = { value: "test-value" }
    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(makeClaudeResult({ result: JSON.stringify(draft) }))
      .mockResolvedValueOnce(makeClaudeResult({ result: "synthesized" }))

    const buildSynthUserPrompt = vi.fn(() => "synth user prompt")

    await invokeEnsemble(makeEnsembleConfig({ specialists: oneSpecialist, buildSynthesizerUserPrompt: buildSynthUserPrompt }))

    expect(buildSynthUserPrompt).toHaveBeenCalledWith([
      expect.objectContaining({ draft }),
    ])
  })
})

describe("invokePlanner", () => {
  it("invokes each specialist in parallel", async () => {
    const specialistResult = makeClaudeResult({ result: makeProposal() })
    const synthResult = makeClaudeResult({ result: "synthesized" })

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(specialistResult) // specialist 1
      .mockResolvedValueOnce(specialistResult) // specialist 2
      .mockResolvedValueOnce(synthResult) // synthesizer

    vi.mocked(scanPhases).mockReturnValue([makePhase()])

    await invokePlanner(makeConfig())

    // 2 specialist calls (from mock registry) + 1 synthesizer call
    expect(invokeClaude).toHaveBeenCalledTimes(3)
  })

  it("handles specialist failures gracefully", async () => {
    const specialistResult = makeClaudeResult({ result: makeProposal() })
    const synthResult = makeClaudeResult({ result: "synthesized" })

    vi.mocked(invokeClaude)
      .mockRejectedValueOnce(new Error("specialist 1 failed"))
      .mockResolvedValueOnce(specialistResult)
      .mockResolvedValueOnce(synthResult)

    vi.mocked(scanPhases).mockReturnValue([makePhase()])

    await invokePlanner(makeConfig())

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("Specialist failed"))
  })

  it("throws when fewer than half of specialists succeed", async () => {
    vi.mocked(invokeClaude)
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))

    await expect(invokePlanner(makeConfig())).rejects.toThrow(
      /requires at least 1 of 2 specialist proposals/,
    )
  })

  it("parses specialist output wrapped in markdown fences", async () => {
    // Mock registry with 1 specialist for this test
    const { buildAgentRegistry } = await import("../../discovery/agent.registry")
    vi.mocked(buildAgentRegistry).mockReturnValueOnce({
      getCorePrompt: vi.fn(() => "synthesizer prompt"),
      getSpecialists: vi.fn(() => [{ perspective: "velocity", overlay: "Build fast" }]),
      getContext: vi.fn(() => "planner context"),
      getSubAgents: vi.fn(() => []),
      getAgentsFlag: vi.fn(() => ({})),
    })

    const fenced = "```json\n" + makeProposal("velocity") + "\n```"
    const specialistResult = makeClaudeResult({ result: fenced })
    const synthResult = makeClaudeResult({ result: "synthesized" })

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(specialistResult)
      .mockResolvedValueOnce(synthResult)

    vi.mocked(scanPhases).mockReturnValue([makePhase()])

    const output = await invokePlanner(makeConfig())

    expect(invokeClaude).toHaveBeenCalledTimes(2)
    expect(output.phases).toHaveLength(1)
  })

  it("throws when specialist JSON is unparseable", async () => {
    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(makeClaudeResult({ result: "not json" }))
      .mockResolvedValueOnce(makeClaudeResult({ result: "also not json" }))

    await expect(invokePlanner(makeConfig())).rejects.toThrow(
      /requires at least 1 of 2 specialist proposals/,
    )

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("Failed to parse"))
  })

  it("throws when specialist cost exceeds budget", async () => {
    // Mock registry with 1 specialist for this test
    const { buildAgentRegistry } = await import("../../discovery/agent.registry")
    vi.mocked(buildAgentRegistry).mockReturnValueOnce({
      getCorePrompt: vi.fn(() => "synthesizer prompt"),
      getSpecialists: vi.fn(() => [{ perspective: "speed", overlay: "Build fast" }]),
      getContext: vi.fn(() => "planner context"),
      getSubAgents: vi.fn(() => []),
      getAgentsFlag: vi.fn(() => ({})),
    })

    vi.mocked(invokeClaude).mockResolvedValueOnce(
      makeClaudeResult({ result: makeProposal(), costUsd: 5.00 }),
    )

    await expect(invokePlanner(makeConfig({ maxBudgetUsd: 1.00 }))).rejects.toThrow(
      /Specialist cost.*exceeds budget/,
    )
  })

  it("calls scanPhases after synthesis", async () => {
    const specialistResult = makeClaudeResult({ result: makeProposal() })
    const synthResult = makeClaudeResult({ result: "synthesized" })

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(specialistResult)
      .mockResolvedValueOnce(specialistResult)
      .mockResolvedValueOnce(synthResult)

    vi.mocked(scanPhases).mockReturnValue([makePhase()])

    await invokePlanner(makeConfig({ phasesDir: "/my/phases" }))

    expect(scanPhases).toHaveBeenCalledWith("/my/phases")
  })

  it("throws when synthesizer produces no phase files", async () => {
    const specialistResult = makeClaudeResult({ result: makeProposal() })
    const synthResult = makeClaudeResult({ result: "synthesized" })

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(specialistResult)
      .mockResolvedValueOnce(specialistResult)
      .mockResolvedValueOnce(synthResult)

    vi.mocked(scanPhases).mockReturnValue([])

    await expect(invokePlanner(makeConfig())).rejects.toThrow(
      "Synthesizer did not generate any phase files",
    )
  })

  it("returns correct shape with cost and duration aggregation", async () => {
    const spec1 = makeClaudeResult({ result: makeProposal(), costUsd: 0.10, durationMs: 3000 })
    const spec2 = makeClaudeResult({ result: makeProposal("thoroughness"), costUsd: 0.15, durationMs: 5000 })
    const synth = makeClaudeResult({ result: "done", costUsd: 0.20, durationMs: 2000 })

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(spec1)
      .mockResolvedValueOnce(spec2)
      .mockResolvedValueOnce(synth)

    vi.mocked(scanPhases).mockReturnValue([makePhase()])

    const output = await invokePlanner(makeConfig())

    expect(output.ensemble.totalCostUsd).toBeCloseTo(0.45)
    expect(output.ensemble.totalDurationMs).toBe(5000 + 2000)
    expect(output.ensemble.specialistResults).toHaveLength(2)
    expect(output.ensemble.synthesizerResult).toBe(synth)
    expect(output.result).toBe(synth)
  })
})
