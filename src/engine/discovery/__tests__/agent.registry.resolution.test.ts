import { describe, it, expect, beforeEach } from "vitest"
import { buildAgentRegistry, clearRegistryCache } from "../agent.registry"

beforeEach(() => {
  clearRegistryCache()
})

describe("buildAgentRegistry — pipeline-entry resolution from src/agents/", () => {
  // Map each pipeline-entry command to the canonical core agent prompt(s) it resolves.
  const COMMAND_TO_CORE_PROMPTS: Record<string, string[]> = {
    shape: ["shaper.md"],
    design: ["designer.md"],
    spec: ["specifier.md"],
    research: ["researcher.md"],
    refine: ["refiner.md"],
    plan: ["planner.md"],
    build: ["builder.md", "reviewer.md"],
    rewind: [],
    retrospective: ["retrospective.md"],
    create: ["shaper.md", "specifier.md", "planner.md", "builder.md", "reviewer.md"],
  }

  for (const [command, prompts] of Object.entries(COMMAND_TO_CORE_PROMPTS)) {
    it(`resolves the canonical agent set for '${command}' from src/agents/`, () => {
      const registry = buildAgentRegistry()

      for (const prompt of prompts) {
        const body = registry.getCorePrompt(prompt)
        expect(body, `${command} → ${prompt}`).toBeTruthy()
        expect(body.length, `${command} → ${prompt}`).toBeGreaterThan(0)
      }
    })
  }

  it("resolves the planners, specifiers, researchers ensembles from src/agents/", () => {
    const registry = buildAgentRegistry()

    expect(registry.getSpecialists("planners").length).toBeGreaterThan(0)
    expect(registry.getSpecialists("specifiers").length).toBeGreaterThan(0)
    expect(registry.getSpecialists("researchers").length).toBeGreaterThan(0)
  })

  it("resolves the visual-coherence specifier when explicitly requested", () => {
    const registry = buildAgentRegistry()
    const visual = registry.getSpecialist("specifiers", "visual-coherence.md")

    expect(visual).not.toBeNull()
    expect(visual!.overlay.length).toBeGreaterThan(0)
  })
})
