import { describe, it, expect, vi, beforeEach } from "vitest"
import { makeConfig, makeClaudeResult, makePhase } from "../../../../test/factories"

vi.mock("../../claude/claude.exec", () => ({
  invokeClaude: vi.fn(),
}))

vi.mock("../../claude/agent.prompt", () => ({
  resolveAgentPrompt: vi.fn(() => "---\nname: planner\n---\n## Phase Spec Format\nspec\n## Process\nprocess"),
}))

vi.mock("../../claude/stream.decode", () => ({
  createDisplayCallbacks: vi.fn(() => ({ onStdout: vi.fn(), flush: vi.fn() })),
}))

vi.mock("../../../store/phases", () => ({
  scanPhases: vi.fn(() => []),
}))

vi.mock("../../discovery/agent.scan", () => ({
  parseFrontmatter: vi.fn(() => ({ name: "test-planner" })),
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

// Mock fs to control planner discovery
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

import { invokePlanner } from "../ensemble.exec"
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

/** Set up fs mocks so that planner discovery finds `count` planners */
const setupPlannerDiscovery = (count: number) => {
  // resolvePlannersDir checks multiple candidates — make the first one match
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    const s = String(p)
    // Match the first candidate path for planners dir
    if (s.includes("agents") && s.includes("planners") && !s.includes("synthesizer")) return true
    // Match synthesizer path
    if (s.includes("synthesizer.md")) return true
    return false
  })
  vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)

  const files = Array.from({ length: count }, (_, i) => `planner-${i}.md`)
  vi.mocked(fs.readdirSync).mockReturnValue(files as any)
}

beforeEach(() => vi.clearAllMocks())

describe("invokePlanner", () => {
  it("throws when no planners are discovered", async () => {
    // existsSync returns false for all planner dirs
    vi.mocked(fs.existsSync).mockReturnValue(false)

    await expect(invokePlanner(makeConfig())).rejects.toThrow("No planner personalities found")
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

    // Synthesizer was called (means specialist proposal was parsed and passed along)
    expect(invokeClaude).toHaveBeenCalledTimes(2)
    expect(output.phases).toHaveLength(1)
  })

  it("handles specialist failures gracefully", async () => {
    setupPlannerDiscovery(2)

    const specialistResult = makeClaudeResult({ result: makeProposal() })
    const synthResult = makeClaudeResult({ result: "synthesized" })

    vi.mocked(invokeClaude)
      .mockRejectedValueOnce(new Error("specialist 1 failed")) // specialist 1 fails
      .mockResolvedValueOnce(specialistResult) // specialist 2 succeeds
      .mockResolvedValueOnce(synthResult) // synthesizer

    vi.mocked(scanPhases).mockReturnValue([makePhase()])

    // With 2 planners, minRequired = ceil(2/2) = 1, so 1 success is enough
    await invokePlanner(makeConfig())

    expect(printError).toHaveBeenCalledWith(expect.stringContaining("Specialist failed"))
  })

  it("throws when fewer than half of specialists succeed", async () => {
    setupPlannerDiscovery(3)

    // All 3 fail
    vi.mocked(invokeClaude)
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockRejectedValueOnce(new Error("fail 3"))

    await expect(invokePlanner(makeConfig())).rejects.toThrow(
      /requires at least 2 of 3 specialist proposals/,
    )
  })

  it("throws when specialist JSON is unparseable", async () => {
    setupPlannerDiscovery(2)

    // Both return invalid JSON
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
      /Specialist planning cost.*exceeds budget/,
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
    // Duration = max(specialist durations) + synth duration
    expect(output.ensemble.totalDurationMs).toBe(5000 + 2000)
    expect(output.ensemble.specialistResults).toHaveLength(2)
    expect(output.ensemble.synthesizerResult).toBe(synth)
    expect(output.result).toBe(synth)
  })
})
