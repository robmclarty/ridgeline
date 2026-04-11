import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir, trackTempDir } from "../../../../test/setup"
import { loadFlavourConfig } from "../flavour.config"

describe("loadFlavourConfig", () => {
  it("returns empty config when no flavour.json exists", () => {
    const dir = trackTempDir(makeTempDir())
    expect(loadFlavourConfig(dir)).toEqual({ recommendedSkills: [] })
  })

  it("loads recommendedSkills from flavour.json", () => {
    const dir = trackTempDir(makeTempDir())
    fs.writeFileSync(
      path.join(dir, "flavour.json"),
      JSON.stringify({ recommendedSkills: ["skill-a", "skill-b"] })
    )
    expect(loadFlavourConfig(dir)).toEqual({ recommendedSkills: ["skill-a", "skill-b"] })
  })

  it("returns empty config when flavour.json is malformed JSON", () => {
    const dir = trackTempDir(makeTempDir())
    fs.writeFileSync(path.join(dir, "flavour.json"), "{ not valid json }")
    expect(loadFlavourConfig(dir)).toEqual({ recommendedSkills: [] })
  })

  it("returns empty config when flavourDir is null", () => {
    expect(loadFlavourConfig(null)).toEqual({ recommendedSkills: [] })
  })

  it("handles flavour.json without recommendedSkills field", () => {
    const dir = trackTempDir(makeTempDir())
    fs.writeFileSync(path.join(dir, "flavour.json"), JSON.stringify({ someOtherField: true }))
    expect(loadFlavourConfig(dir)).toEqual({ recommendedSkills: [] })
  })
})
