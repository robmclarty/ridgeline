import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { program } from "../cli.js"

const baselineDir = path.resolve(
  process.cwd(),
  ".ridgeline/builds/fascicle-migration/baseline/help",
)

const helpForName = (name: string): string => {
  if (name === "ridgeline") return program.helpInformation()
  const sub = program.commands.find(c => c.name() === name)
  if (sub) return sub.helpInformation()
  return program.helpInformation()
}

describe("--help byte-equality vs Phase 8 baseline (AC4)", () => {
  const files = readdirSync(baselineDir)
    .filter(f => f.endsWith(".txt"))
    .sort()

  it("baseline directory is non-empty", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    const name = file.replace(/\.txt$/, "")
    it(`${name} --help matches baseline/help/${file}`, () => {
      const expected = readFileSync(path.join(baselineDir, file), "utf8")
      const actual = helpForName(name)
      expect(actual).toBe(expected)
    })
  }
})
