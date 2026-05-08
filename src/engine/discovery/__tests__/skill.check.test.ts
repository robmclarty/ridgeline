import { describe, it, expect } from "vitest"
import { parseSkillCompatibility, formatSkillAvailability, checkRecommendedSkills } from "../skill.check.js"
import type { SkillAvailability } from "../skill.check.js"

describe("parseSkillCompatibility", () => {
  it("extracts compatibility from valid frontmatter", () => {
    const content = `---
name: agent-browser
description: Some skill
compatibility: Requires agent-browser CLI (npm i -g agent-browser)
---

# Agent Browser
`
    expect(parseSkillCompatibility(content)).toBe(
      "Requires agent-browser CLI (npm i -g agent-browser)"
    )
  })

  it("returns null for no frontmatter", () => {
    const content = "# Just a heading\n\nSome content."
    expect(parseSkillCompatibility(content)).toBeNull()
  })

  it("returns null for frontmatter without compatibility field", () => {
    const content = `---
name: some-skill
description: A skill without compatibility
---

# Some Skill
`
    expect(parseSkillCompatibility(content)).toBeNull()
  })

  it("handles compatibility with different install tools", () => {
    const content = `---
name: lighthouse
compatibility: Requires Lighthouse CLI (npm i -g lighthouse)
---
`
    expect(parseSkillCompatibility(content)).toBe("Requires Lighthouse CLI (npm i -g lighthouse)")
  })
})

describe("formatSkillAvailability", () => {
  it("returns empty string for empty results", () => {
    expect(formatSkillAvailability([])).toBe("")
  })

  it("formats results correctly", () => {
    const results: SkillAvailability[] = [
      { name: "agent-browser", isAvailable: true, compatibility: null },
      { name: "lighthouse", isAvailable: false, compatibility: null },
    ]
    const output = formatSkillAvailability(results)
    expect(output).toContain("Recommended tools:")
    expect(output).toContain("✓ agent-browser")
    expect(output).toContain("(found)")
    expect(output).toContain("✗ lighthouse")
    expect(output).toContain("(not found)")
  })

  it("includes install commands for missing tools", () => {
    const results: SkillAvailability[] = [
      { name: "agent-browser", isAvailable: true, compatibility: null },
      {
        name: "lighthouse",
        isAvailable: false,
        compatibility: "Requires Lighthouse CLI (npm i -g lighthouse)",
      },
    ]
    const output = formatSkillAvailability(results)
    expect(output).toContain("Install missing tools:")
    expect(output).toContain("npm i -g lighthouse")
    expect(output).toContain("These are optional")
  })

  it("does not show install section when all tools are available", () => {
    const results: SkillAvailability[] = [
      { name: "agent-browser", isAvailable: true, compatibility: null },
    ]
    const output = formatSkillAvailability(results)
    expect(output).not.toContain("Install missing tools:")
  })
})

describe("checkRecommendedSkills", () => {
  it("returns empty array for empty input", () => {
    expect(checkRecommendedSkills([])).toEqual([])
  })

  it("returns results for known bundled skill names", () => {
    const results = checkRecommendedSkills(["agent-browser", "lighthouse"])
    expect(results).toHaveLength(2)

    const agentBrowser = results.find(r => r.name === "agent-browser")
    expect(agentBrowser).toBeDefined()
    expect(agentBrowser!.compatibility).toContain("Requires agent-browser")
    expect(typeof agentBrowser!.isAvailable).toBe("boolean")

    const lighthouse = results.find(r => r.name === "lighthouse")
    expect(lighthouse).toBeDefined()
    expect(lighthouse!.compatibility).toContain("Requires Lighthouse")
  })

  it("handles unknown skill names gracefully", () => {
    const results = checkRecommendedSkills(["nonexistent-skill-xyz"])
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({
      name: "nonexistent-skill-xyz",
      isAvailable: false,
      compatibility: null,
    })
  })
})
