import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const baselineDir = path.resolve(
  process.cwd(),
  ".ridgeline/builds/fascicle-migration/baseline/dts",
)

let outDir = ""

const compileDeclarationsTo = (target: string): void => {
  execFileSync(
    "npx",
    ["tsc", "--emitDeclarationOnly", "--outDir", target],
    { cwd: process.cwd(), stdio: "pipe" },
  )
}

describe("tsc --emitDeclarationOnly byte-equality vs Phase 8 baseline (AC5)", () => {
  beforeAll(() => {
    outDir = mkdtempSync(path.join(os.tmpdir(), "ridgeline-dts-"))
    compileDeclarationsTo(outDir)
  }, 120_000)

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true })
  })

  const files = readdirSync(baselineDir)
    .filter(f => f.endsWith(".d.ts"))
    .sort()

  it("baseline directory is non-empty", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`commands/${file} matches baseline/dts/${file}`, () => {
      const expected = readFileSync(path.join(baselineDir, file), "utf8")
      const actual = readFileSync(path.join(outDir, "commands", file), "utf8")
      expect(actual).toBe(expected)
    })
  }
})
