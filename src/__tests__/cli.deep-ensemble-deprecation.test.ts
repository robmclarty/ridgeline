import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it, expect } from "vitest"

const CLI_SRC = fs.readFileSync(path.resolve(__dirname, "../cli.ts"), "utf-8")

describe("--deep-ensemble deprecation wiring", () => {
  it("emits a stderr deprecation line when --deep-ensemble is in argv", () => {
    expect(CLI_SRC).toContain('includes("--deep-ensemble")')
    expect(CLI_SRC).toContain("[deprecated] --deep-ensemble is now --thorough; continuing with --thorough")
  })

  it("declares the deprecated flag with hideHelp() so `--help` does not list it", () => {
    expect(CLI_SRC).toMatch(/new Option\("--deep-ensemble".*?\.hideHelp\(\)/s)
  })

  it("maps --deep-ensemble to isThorough alongside --thorough", () => {
    expect(CLI_SRC).toMatch(/isThorough:\s*argv\.includes\("--thorough"\)\s*\|\|\s*argv\.includes\("--deep-ensemble"\)/)
  })

  it("pipes --thorough through the public option on the default command", () => {
    expect(CLI_SRC).toContain("addPreflightOptions(program")
    expect(CLI_SRC).toContain('"--thorough", "Use a 3-specialist ensemble (default: 2)"')
  })
})
