import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  }
})

import * as fs from "node:fs"
import { loadShapeDefinitions, detectShapes } from "../detect"

const webVisual = {
  name: "web-visual",
  keywords: ["UI", "frontend", "web app", "dashboard"],
  toolFamily: "web-visual",
  reviewerContext: "Check responsive behavior.",
}

const gameVisual = {
  name: "game-visual",
  keywords: ["game", "sprite", "WebGL"],
  toolFamily: "game-visual",
  reviewerContext: "Verify asset dimensions.",
}

const printLayout = {
  name: "print-layout",
  keywords: ["print", "PDF", "brochure"],
  toolFamily: "print-layout",
  reviewerContext: "Verify bleed and trim.",
}

beforeEach(() => vi.clearAllMocks())

describe("loadShapeDefinitions", () => {
  it("loads all .json files from the shapes directory", () => {
    vi.mocked(fs.readdirSync).mockReturnValue(["web-visual.json", "game-visual.json"] as unknown as ReturnType<typeof fs.readdirSync>)
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce(JSON.stringify(webVisual))
      .mockReturnValueOnce(JSON.stringify(gameVisual))

    const defs = loadShapeDefinitions()

    expect(defs).toHaveLength(2)
    expect(defs[0].name).toBe("web-visual")
    expect(defs[1].name).toBe("game-visual")
  })

  it("skips non-json files", () => {
    vi.mocked(fs.readdirSync).mockReturnValue(["web-visual.json", "README.md", ".DS_Store"] as unknown as ReturnType<typeof fs.readdirSync>)
    vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify(webVisual))

    const defs = loadShapeDefinitions()

    expect(defs).toHaveLength(1)
    expect(fs.readFileSync).toHaveBeenCalledTimes(1)
  })

  it("skips malformed JSON files", () => {
    vi.mocked(fs.readdirSync).mockReturnValue(["good.json", "bad.json"] as unknown as ReturnType<typeof fs.readdirSync>)
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce(JSON.stringify(webVisual))
      .mockReturnValueOnce("not valid json {{{")

    const defs = loadShapeDefinitions()

    expect(defs).toHaveLength(1)
    expect(defs[0].name).toBe("web-visual")
  })

  it("skips files missing required fields", () => {
    const missingKeywords = { name: "incomplete", toolFamily: "x", reviewerContext: "y" }
    const missingName = { keywords: ["a"], toolFamily: "x", reviewerContext: "y" }

    vi.mocked(fs.readdirSync).mockReturnValue(["a.json", "b.json"] as unknown as ReturnType<typeof fs.readdirSync>)
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce(JSON.stringify(missingKeywords))
      .mockReturnValueOnce(JSON.stringify(missingName))

    const defs = loadShapeDefinitions()

    expect(defs).toHaveLength(0)
  })
})

describe("detectShapes", () => {
  const definitions = [webVisual, gameVisual, printLayout]

  it("matches keywords case-insensitively", () => {
    const result = detectShapes("I need a DASHBOARD for my app", definitions)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("web-visual")
  })

  it("matches multiple shape categories simultaneously", () => {
    const result = detectShapes("Build a web app game with WebGL", definitions)
    const names = result.map(d => d.name)
    expect(names).toContain("web-visual")
    expect(names).toContain("game-visual")
  })

  it("returns empty array when no keywords match", () => {
    const result = detectShapes("Write a haiku about clouds", definitions)
    expect(result).toHaveLength(0)
  })

  it("matches multi-word keywords", () => {
    const result = detectShapes("I need a web app built quickly", definitions)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("web-visual")
  })

  it("handles empty text", () => {
    const result = detectShapes("", definitions)
    expect(result).toHaveLength(0)
  })

  it("handles empty definitions array", () => {
    const result = detectShapes("UI dashboard frontend", [])
    expect(result).toHaveLength(0)
  })
})
