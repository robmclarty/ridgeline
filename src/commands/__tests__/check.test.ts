import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../engine/discovery/flavour.resolve", () => ({
  resolveFlavour: vi.fn(),
}))

vi.mock("../../engine/discovery/flavour.config", () => ({
  loadFlavourConfig: vi.fn(),
}))

vi.mock("../../engine/discovery/skill.check", () => ({
  checkRecommendedSkills: vi.fn(),
  formatSkillAvailability: vi.fn(),
}))

vi.mock("../../stores/settings", () => ({
  loadSettings: vi.fn(() => ({})),
}))

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
}))

import { resolveFlavour } from "../../engine/discovery/flavour.resolve"
import { loadFlavourConfig } from "../../engine/discovery/flavour.config"
import { checkRecommendedSkills, formatSkillAvailability } from "../../engine/discovery/skill.check"
import { loadSettings } from "../../stores/settings"
import { printInfo } from "../../ui/output"
import { runCheck } from "../check"

describe("commands/check", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("prints message when no flavour is specified", () => {
    vi.mocked(resolveFlavour).mockReturnValue(null)
    vi.mocked(loadSettings).mockReturnValue({})

    runCheck({})

    expect(printInfo).toHaveBeenCalledWith(
      expect.stringContaining("No flavour specified"),
    )
  })

  it("prints message when flavour has no recommended skills", () => {
    vi.mocked(resolveFlavour).mockReturnValue("/tmp/flavours/web-ui")
    vi.mocked(loadFlavourConfig).mockReturnValue({ recommendedSkills: [] })

    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    runCheck({ flavour: "web-ui" })
    spy.mockRestore()

    expect(printInfo).toHaveBeenCalledWith("Flavour: web-ui")
  })

  it("checks and displays recommended skills", () => {
    vi.mocked(resolveFlavour).mockReturnValue("/tmp/flavours/web-ui")
    vi.mocked(loadFlavourConfig).mockReturnValue({
      recommendedSkills: ["agent-browser", "lighthouse"],
    })
    vi.mocked(checkRecommendedSkills).mockReturnValue([
      { name: "agent-browser", isAvailable: true, compatibility: null },
      { name: "lighthouse", isAvailable: false, compatibility: "Requires lighthouse (npm i -g lighthouse)" },
    ])
    vi.mocked(formatSkillAvailability).mockReturnValue("  tools output")

    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    runCheck({ flavour: "web-ui" })
    spy.mockRestore()

    expect(checkRecommendedSkills).toHaveBeenCalledWith(["agent-browser", "lighthouse"])
    expect(formatSkillAvailability).toHaveBeenCalled()
  })

  it("falls back to settings.json flavour when no --flavour flag", () => {
    vi.mocked(loadSettings).mockReturnValue({ flavour: "web-game" })
    vi.mocked(resolveFlavour).mockReturnValue("/tmp/flavours/web-game")
    vi.mocked(loadFlavourConfig).mockReturnValue({ recommendedSkills: [] })

    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    runCheck({})
    spy.mockRestore()

    expect(resolveFlavour).toHaveBeenCalledWith("web-game")
  })
})
