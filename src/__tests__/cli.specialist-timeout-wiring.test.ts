import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const CLI_SRC = fs.readFileSync(path.resolve(__dirname, "../cli.ts"), "utf-8")
const CREATE_SRC = fs.readFileSync(path.resolve(__dirname, "../commands/create.ts"), "utf-8")

const splitActions = (src: string): Array<{ name: string; body: string }> => {
  const blocks: Array<{ name: string; body: string }> = []
  const cmdMatches: Array<{ name: string; index: number }> = []
  const cmdRegex = /\.command\("([a-z-]+)/g
  let match: RegExpExecArray | null
  while ((match = cmdRegex.exec(src)) !== null) {
    cmdMatches.push({ name: match[1], index: match.index })
  }
  for (let i = 0; i < cmdMatches.length; i++) {
    const { name, index } = cmdMatches[i]
    const end = i + 1 < cmdMatches.length ? cmdMatches[i + 1].index : src.length
    const segment = src.slice(index, end)
    const actionIdx = segment.indexOf(".action(")
    if (actionIdx === -1) continue
    blocks.push({ name, body: segment.slice(actionIdx) })
  }
  return blocks
}

describe("cli specialist-timeout wiring", () => {
  const blocks = splitActions(CLI_SRC)
  const byName = new Map(blocks.map((b) => [b.name, b.body]))

  // Commands that dispatch specialist ensembles outside resolveConfig must
  // forward the resolved specialistTimeoutSeconds setting from settings.json.
  const ENSEMBLE_DISPATCHERS = ["spec", "research"]

  for (const name of ENSEMBLE_DISPATCHERS) {
    it(`${name} command forwards specialistTimeoutSeconds from settings`, () => {
      const body = byName.get(name)
      expect(body, `command "${name}" should be present`).toBeDefined()
      expect(body!).toContain("resolveSpecialistTimeoutSeconds(")
      expect(body!).toContain("specialistTimeoutSeconds:")
    })
  }

  it("create command (default action) forwards specialistTimeoutSeconds when dispatching to spec", () => {
    expect(CREATE_SRC).toContain("resolveSpecialistTimeoutSeconds(")
    // Ensure it's wired into the spec dispatch branch, not just imported.
    const specBranchIdx = CREATE_SRC.indexOf('case "spec"')
    expect(specBranchIdx).toBeGreaterThan(-1)
    const specBranch = CREATE_SRC.slice(specBranchIdx, specBranchIdx + 600)
    expect(specBranch).toContain("specialistTimeoutSeconds:")
  })
})
