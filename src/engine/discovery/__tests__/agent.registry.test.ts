import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock fs before importing the module under test so resolveDefaultAgentsDir
// can be controlled. We must keep statSync callable with isDirectory().
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    statSync: vi.fn(() => ({ isDirectory: () => false })),
    readdirSync: vi.fn(() => [] as string[]),
    readFileSync: vi.fn(() => ""),
  }
})

import * as fs from "node:fs"
import { buildAgentRegistry, clearRegistryCache } from "../agent.registry.js"

beforeEach(() => {
  vi.clearAllMocks()
  clearRegistryCache()
})

// ---------------------------------------------------------------------------
// getSpecialist
// ---------------------------------------------------------------------------

describe("getSpecialist", () => {
  it("returns a SpecialistDef for a valid file with frontmatter and body", () => {
    const fileContent = [
      "---",
      "name: My Specialist",
      "description: Does things",
      "perspective: A focused lens",
      "---",
      "",
      "You are a specialist that does specific things.",
    ].join("\n")

    // resolveDefaultAgentsDir checks paths ending in "/agents"; match by suffix.
    // resolveSubfolder then checks agentsDir/specifiers — match by suffix too.
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p)
      return s.endsWith("/agents") || s.endsWith("/agents/specifiers") || s.endsWith("/agents/specifiers/my-specialist.md")
    })
    vi.mocked(fs.statSync).mockImplementation((p: any) => {
      const s = String(p)
      const isDir = s.endsWith("/agents") || s.endsWith("/agents/specifiers")
      return { isDirectory: () => isDir } as any
    })
    vi.mocked(fs.readFileSync).mockReturnValue(fileContent)

    const registry = buildAgentRegistry()
    const result = registry.getSpecialist("specifiers", "my-specialist.md")

    expect(result).not.toBeNull()
    expect(result!.perspective).toBe("A focused lens")
    expect(result!.overlay).toBe("You are a specialist that does specific things.")
  })

  it("returns null when the file does not exist", () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p)
      // agents dir exists, specifiers subdir exists, but the file does not
      return s.endsWith("/agents") || s.endsWith("/agents/specifiers")
    })
    vi.mocked(fs.statSync).mockImplementation((p: any) => {
      const s = String(p)
      const isDir = s.endsWith("/agents") || s.endsWith("/agents/specifiers")
      return { isDirectory: () => isDir } as any
    })

    const registry = buildAgentRegistry()
    const result = registry.getSpecialist("specifiers", "nonexistent.md")

    expect(result).toBeNull()
  })

  it("returns null when the file has no valid frontmatter", () => {
    const fileContent = "This is just plain markdown with no frontmatter."

    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p)
      return s.endsWith("/agents") || s.endsWith("/agents/specifiers") || s.endsWith("/agents/specifiers/no-fm.md")
    })
    vi.mocked(fs.statSync).mockImplementation((p: any) => {
      const s = String(p)
      const isDir = s.endsWith("/agents") || s.endsWith("/agents/specifiers")
      return { isDirectory: () => isDir } as any
    })
    vi.mocked(fs.readFileSync).mockReturnValue(fileContent)

    const registry = buildAgentRegistry()
    const result = registry.getSpecialist("specifiers", "no-fm.md")

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getSpecialists — exclusion of visual-coherence.md
// ---------------------------------------------------------------------------

describe("getSpecialists", () => {
  it("excludes visual-coherence.md from auto-discovery results", () => {
    const validContent = [
      "---",
      "name: Regular Specialist",
      "description: A regular one",
      "perspective: Standard view",
      "---",
      "",
      "Body text for regular specialist.",
    ].join("\n")

    const visualCoherenceContent = [
      "---",
      "name: Visual Coherence",
      "description: Visual stuff",
      "perspective: Visual lens",
      "---",
      "",
      "Body text for visual coherence.",
    ].join("\n")

    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p)
      return s.endsWith("/agents") || s.endsWith("/agents/specifiers")
    })
    vi.mocked(fs.statSync).mockImplementation((p: any) => {
      const s = String(p)
      const isDir = s.endsWith("/agents") || s.endsWith("/agents/specifiers")
      return { isDirectory: () => isDir } as any
    })
    vi.mocked(fs.readdirSync).mockReturnValue(
      ["regular.md", "visual-coherence.md"] as any,
    )
    vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
      if (String(p).endsWith("visual-coherence.md")) return visualCoherenceContent
      return validContent
    })

    const registry = buildAgentRegistry()
    const specialists = registry.getSpecialists("specifiers")

    const names = specialists.map((s) => s.perspective)
    expect(names).toContain("Standard view")
    expect(names).not.toContain("Visual lens")
    expect(specialists).toHaveLength(1)
  })
})
