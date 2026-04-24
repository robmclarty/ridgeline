import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const UI_MODULES = ["spinner", "logger", "output", "prompt", "summary", "transcript"]

const FEATURE_MODULES: string[] = [
  "../../commands/qa-workflow.ts",
  "../../engine/claude/stream.display.ts",
  "../../catalog/build-catalog.ts",
  "../../catalog/classify.ts",
  "../../catalog/pack-sprites.ts",
  "../../catalog/vision-describe.ts",
]

const escapeChar = String.fromCharCode(27)

describe("no raw ANSI in feature UI modules", () => {
  for (const name of UI_MODULES) {
    it(`${name}.ts contains no raw ANSI escape sequences`, () => {
      const file = path.resolve(__dirname, `../${name}.ts`)
      const src = fs.readFileSync(file, "utf-8")
      expect(src).not.toContain(escapeChar)
      expect(src).not.toContain("\\x1b")
      expect(src).not.toContain("\\u001b")
    })
  }

  for (const rel of FEATURE_MODULES) {
    it(`${rel} contains no raw ANSI escape sequences`, () => {
      const file = path.resolve(__dirname, rel)
      const src = fs.readFileSync(file, "utf-8")
      expect(src).not.toContain(escapeChar)
      expect(src).not.toContain("\\x1b")
      expect(src).not.toContain("\\u001b")
    })
  }

  it("only color.ts emits cyan SGR codes for the running/info role", () => {
    const colorSrc = fs.readFileSync(path.resolve(__dirname, "../color.ts"), "utf-8")
    expect(colorSrc).toContain("CODE_INFO")
    expect(colorSrc).toContain("36")
  })
})
