import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it, expect } from "vitest"

const CLI_SRC = fs.readFileSync(path.resolve(__dirname, "../main.ts"), "utf-8")

describe("--deep-ensemble deprecation wiring", () => {
  it("emits a stderr deprecation line when --deep-ensemble is in argv", () => {
    expect(CLI_SRC).toContain('includes("--deep-ensemble")')
    expect(CLI_SRC).toContain("[deprecated] --deep-ensemble is now --specialists 3 (default); continuing")
  })

  it("declares the deprecated flag with hideHelp() so `--help` does not list it", () => {
    expect(CLI_SRC).toMatch(/new Option\("--deep-ensemble".*?\.hideHelp\(\)/s)
  })

  it("exposes --specialists as the canonical ensemble-size flag", () => {
    expect(CLI_SRC).toContain("addPreflightOptions(program")
    expect(CLI_SRC).toContain('"--specialists <n>"')
  })

  it("retains --thorough as a compatibility alias for --specialists 3", () => {
    expect(CLI_SRC).toContain('"--thorough"')
  })
})

describe("--unsafe deprecation wiring", () => {
  it("emits a stderr deprecation line when --unsafe is in argv", () => {
    expect(CLI_SRC).toContain('includes("--unsafe")')
    expect(CLI_SRC).toContain("[deprecated] --unsafe is now --sandbox=off; continuing")
  })

  it("exposes --sandbox <mode> as the canonical sandbox flag", () => {
    expect(CLI_SRC).toContain('"--sandbox <mode>"')
  })
})
