import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import type { Command, Option } from "commander"
import { describe, expect, it } from "vitest"
import { program } from "../cli.js"

const baselineDir = path.resolve(
  process.cwd(),
  ".ridgeline/builds/fascicle-migration/baseline/options",
)

type SerializedOption = {
  flags: string
  description: string
  defaultValue: unknown
  mandatory: boolean
  hidden: boolean
}

const serializeOptions = (cmd: Command): SerializedOption[] =>
  cmd.options
    .map((o: Option): SerializedOption => ({
      flags: o.flags,
      description: o.description,
      defaultValue: o.defaultValue ?? null,
      mandatory: o.mandatory ?? false,
      hidden: o.hidden ?? false,
    }))
    .sort((a, b) => a.flags.localeCompare(b.flags))

const optionsForName = (name: string): SerializedOption[] => {
  if (name === "ridgeline") return serializeOptions(program)
  const sub = program.commands.find(c => c.name() === name)
  if (!sub) throw new Error(`unknown subcommand: ${name}`)
  return serializeOptions(sub)
}

describe("commander option-set byte-equality vs Phase 8 baseline (AC6)", () => {
  const files = readdirSync(baselineDir)
    .filter(f => f.endsWith(".json"))
    .sort()

  it("baseline directory is non-empty", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    const name = file.replace(/\.json$/, "")
    it(`${name} option set matches baseline/options/${file}`, () => {
      const expected = readFileSync(path.join(baselineDir, file), "utf8")
      const actual = JSON.stringify(optionsForName(name), null, 2) + "\n"
      expect(actual).toBe(expected)
    })
  }
})
