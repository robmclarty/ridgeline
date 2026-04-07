import { describe, it, expect, vi, beforeEach } from "vitest"
import { makeConfig, makeClaudeResult, makePhase } from "../../../../test/factories"

vi.mock("../../claude/claude.exec", () => ({
  invokeClaude: vi.fn(),
}))

vi.mock("../../claude/agent.prompt", () => ({
  resolveAgentPrompt: vi.fn(() => "synthesizer prompt"),
}))

vi.mock("../../claude/stream.decode", () => ({
  createDisplayCallbacks: vi.fn(() => ({ onStdout: vi.fn(), flush: vi.fn() })),
}))

vi.mock("../../../store/phases", () => ({
  scanPhases: vi.fn(() => []),
}))

vi.mock("../../discovery/agent.scan", () => ({
  parseFrontmatter: vi.fn(() => ({ name: "test-agent" })),
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

vi.mock("../pipeline.shared", () => ({
  createStderrHandler: vi.fn(() => vi.fn()),
}))

// Mock fs to control specialist discovery
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    statSync: vi.fn(() => ({ isDirectory: () => true })),
    readdirSync: vi.fn(() => []),
    readFileSync: vi.fn(() => "---\nname: test\nperspective: speed\n---\nBuild fast"),
  }
})

import { invokeEnsemble, invokePlanner, extractJSON } from "../ensemble.exec"
import { invokeClaude } from "../../claude/claude.exec"
import { scanPhases } from "../../../store/phases"
import { printError } from "../../../ui/output"
import * as fs from "node:fs"

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

/** Set up fs mocks so that specialist discovery finds `count` agents in `subdir`. */
const setupDiscovery = (count: number, subdir = "planners") => {
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    const s = String(p)
    if (s.includes("agents") && s.includes(subdir) && !s.includes("context.md")) return true
    // Match context.md reads for planners
    if (s.includes("context.md")) return true
    return false
  })
  vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)

  const files = Array.from({ length: count }, (_, i) => `agent-${i}.md`)
  vi.mocked(fs.readdirSync).mockReturnValue(files as any)
}

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

  const makeEnsembleConfig = (overrides = {}) => ({
    label: "Testing",
    agentDir: "test-agents",
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

  it("throws when no specialists are discovered", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    await expect(
      invokeEnsemble(makeEnsembleConfig()),
    ).rejects.toThrow("No specialist overlays found")
  })

  it("spawns each specialist in parallel", async () => {
    setupDiscovery(2, "test-agents")

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
    setupDiscovery(2, "test-agents")

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
    setupDiscovery(2, "test-agents")

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
    setupDiscovery(3, "test-agents")

    vi.mocked(invokeClaude)
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockRejectedValueOnce(new Error("fail 3"))

    await expect(
      invokeEnsemble(makeEnsembleConfig()),
    ).rejects.toThrow(/requires at least 2 of 3/)
  })

  it("throws when specialist cost exceeds budget", async () => {
    setupDiscovery(1, "test-agents")

    vi.mocked(invokeClaude).mockResolvedValueOnce(
      makeClaudeResult({ result: makeSimpleDraft(), costUsd: 5.00 }),
    )

    await expect(
      invokeEnsemble(makeEnsembleConfig({ maxBudgetUsd: 1.00 })),
    ).rejects.toThrow(/Specialist cost.*exceeds budget/)
  })

  it("calls verify callback after synthesis", async () => {
    setupDiscovery(1, "test-agents")

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(makeClaudeResult({ result: makeSimpleDraft() }))
      .mockResolvedValueOnce(makeClaudeResult({ result: "synthesized" }))

    const verify = vi.fn()
    await invokeEnsemble(makeEnsembleConfig({ verify }))

    expect(verify).toHaveBeenCalledTimes(1)
  })

  it("throws when verify fails", async () => {
    setupDiscovery(1, "test-agents")

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(makeClaudeResult({ result: makeSimpleDraft() }))
      .mockResolvedValueOnce(makeClaudeResult({ result: "synthesized" }))

    await expect(
      invokeEnsemble(makeEnsembleConfig({
        verify: () => { throw new Error("Verification failed") },
      })),
    ).rejects.toThrow("Verification failed")
  })

  it("aggregates costs and durations correctly", async () => {
    setupDiscovery(2, "test-agents")

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
    setupDiscovery(1, "test-agents")

    const draft = { value: "test-value" }
    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(makeClaudeResult({ result: JSON.stringify(draft) }))
      .mockResolvedValueOnce(makeClaudeResult({ result: "synthesized" }))

    const buildSynthUserPrompt = vi.fn(() => "synth user prompt")

    await invokeEnsemble(makeEnsembleConfig({ buildSynthesizerUserPrompt: buildSynthUserPrompt }))

    expect(buildSynthUserPrompt).toHaveBeenCalledWith([
      expect.objectContaining({ draft }),
    ])
  })
})

describe("invokePlanner", () => {
  /** Set up fs mocks for planner discovery + context.md loading. */
  const setupPlannerDiscovery = (count: number) => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p)
      if (s.includes("agents") && s.includes("planners") && !s.includes("context.md")) return true
      if (s.includes("context.md")) return true
      return false
    })
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)

    const files = Array.from({ length: count }, (_, i) => `planner-${i}.md`)
    // context.md is excluded from discovery but loaded separately
    vi.mocked(fs.readdirSync).mockReturnValue(files as any)
  }

  it("throws when planner context is missing", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    await expect(invokePlanner(makeConfig())).rejects.toThrow("Planner specialist context not found")
  })

  it("invokes each specialist in parallel", async () => {
    setupPlannerDiscovery(2)

    const specialistResult = makeClaudeResult({ result: makeProposal() })
    const synthResult = makeClaudeResult({ result: "synthesized" })

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(specialistResult) // specialist 1
      .mockResolvedValueOnce(specialistResult) // specialist 2
      .mockResolvedValueOnce(synthResult) // synthesizer

    vi.mocked(scanPhases).mockReturnValue([makePhase()])

    await invokePlanner(makeConfig())

    // 2 specialist calls + 1 synthesizer call
    expect(invokeClaude).toHaveBeenCalledTimes(3)
  })

  it("parses specialist JSON proposals", async () => {
    setupPlannerDiscovery(1)

    const specialistResult = makeClaudeResult({ result: makeProposal("velocity") })
    const synthResult = makeClaudeResult({ result: "synthesized" })

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(specialistResult)
      .mockResolvedValueOnce(synthResult)

    vi.mocked(scanPhases).mockReturnValue([makePhase()])

    const output = await invokePlanner(makeConfig())

    expect(invokeClaude).toHaveBeenCalledTimes(2)
    expect(output.phases).toHaveLength(1)
  })

  it("handles specialist failures gracefully", async () => {
    setupPlannerDiscovery(2)

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
    setupPlannerDiscovery(3)

    vi.mocked(invokeClaude)
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockRejectedValueOnce(new Error("fail 3"))

    await expect(invokePlanner(makeConfig())).rejects.toThrow(
      /requires at least 2 of 3 specialist proposals/,
    )
  })

  it("parses specialist output wrapped in markdown fences", async () => {
    setupPlannerDiscovery(1)

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
    setupPlannerDiscovery(2)

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(makeClaudeResult({ result: "not json" }))
      .mockResolvedValueOnce(makeClaudeResult({ result: "also not json" }))

    await expect(invokePlanner(makeConfig())).rejects.toThrow(
      /requires at least 1 of 2 specialist proposals/,
    )

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("Failed to parse"))
  })

  it("throws when specialist cost exceeds budget", async () => {
    setupPlannerDiscovery(1)

    vi.mocked(invokeClaude).mockResolvedValueOnce(
      makeClaudeResult({ result: makeProposal(), costUsd: 5.00 }),
    )

    await expect(invokePlanner(makeConfig({ maxBudgetUsd: 1.00 }))).rejects.toThrow(
      /Specialist cost.*exceeds budget/,
    )
  })

  it("calls scanPhases after synthesis", async () => {
    setupPlannerDiscovery(1)

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(makeClaudeResult({ result: makeProposal() }))
      .mockResolvedValueOnce(makeClaudeResult({ result: "synthesized" }))

    vi.mocked(scanPhases).mockReturnValue([makePhase()])

    await invokePlanner(makeConfig({ phasesDir: "/my/phases" }))

    expect(scanPhases).toHaveBeenCalledWith("/my/phases")
  })

  it("throws when synthesizer produces no phase files", async () => {
    setupPlannerDiscovery(1)

    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(makeClaudeResult({ result: makeProposal() }))
      .mockResolvedValueOnce(makeClaudeResult({ result: "synthesized" }))

    vi.mocked(scanPhases).mockReturnValue([])

    await expect(invokePlanner(makeConfig())).rejects.toThrow(
      "Synthesizer did not generate any phase files",
    )
  })

  it("returns correct shape with cost and duration aggregation", async () => {
    setupPlannerDiscovery(2)

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
