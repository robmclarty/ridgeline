import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const CLI_SRC = fs.readFileSync(path.resolve(__dirname, "../cli.ts"), "utf-8")

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

describe("cli preflight wiring", () => {
  const blocks = splitActions(CLI_SRC)
  const byName = new Map(blocks.map((b) => [b.name, b.body]))

  const PIPELINE_ENTRY = ["shape", "design", "spec", "research", "refine", "plan", "build", "rewind", "retrospective"]
  const NON_PIPELINE = ["catalog", "dry-run", "clean", "check", "ui"]

  for (const name of PIPELINE_ENTRY) {
    it(`${name} command invokes runPreflightGuard or withConfigAndPreflight`, () => {
      const body = byName.get(name)
      expect(body, `command "${name}" should be present`).toBeDefined()
      const usesGuard = body!.includes("runPreflightGuard()") || body!.includes("withConfigAndPreflight")
      expect(usesGuard).toBe(true)
    })
  }

  for (const name of NON_PIPELINE) {
    it(`${name} command does NOT trigger preflight`, () => {
      const body = byName.get(name)
      expect(body, `command "${name}" should be present`).toBeDefined()
      expect(body!.includes("runPreflightGuard()")).toBe(false)
      expect(body!.includes("withConfigAndPreflight")).toBe(false)
    })
  }

  it("default action (create) invokes runPreflightGuard", () => {
    // Default action lives outside .command() — match the action that calls runCreate
    const idx = CLI_SRC.indexOf("await runCreate(")
    expect(idx).toBeGreaterThan(-1)
    const window = CLI_SRC.slice(Math.max(0, idx - 800), idx)
    expect(window).toContain("runPreflightGuard()")
  })
})
