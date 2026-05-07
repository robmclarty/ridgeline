import { describe, it, expect } from "vitest"
import { parseConventions, inferDefaults, AUTO_DESCRIBE_CATEGORIES } from "../parse-conventions.js"

describe("parseConventions", () => {
  it("parses category/subject/state from standard path", () => {
    const result = parseConventions("characters/knight-walk.png")
    expect(result).toEqual({
      category: "characters",
      name: "knight-walk",
      subject: "knight",
      state: "walk",
    })
  })

  it("parses multi-segment state", () => {
    const result = parseConventions("characters/knight-walk-left.png")
    expect(result).toEqual({
      category: "characters",
      name: "knight-walk-left",
      subject: "knight",
      state: "walk-left",
    })
  })

  it("handles file without subdirectory", () => {
    const result = parseConventions("export_003.png")
    expect(result).toEqual({
      category: "uncategorized",
      name: "export_003",
      subject: "export_003",
      state: null,
    })
  })

  it("handles file with no dash (no state)", () => {
    const result = parseConventions("tiles/ground.png")
    expect(result).toEqual({
      category: "tiles",
      name: "ground",
      subject: "ground",
      state: null,
    })
  })

  it("handles nested subdirectories (uses immediate parent)", () => {
    const result = parseConventions("sprites/characters/hero-idle.png")
    expect(result).toEqual({
      category: "characters",
      name: "hero-idle",
      subject: "hero",
      state: "idle",
    })
  })
})

describe("inferDefaults", () => {
  it("returns character defaults", () => {
    expect(inferDefaults("characters")).toEqual({
      zLayer: "entity",
      anchor: "bottom-center",
    })
  })

  it("returns tile defaults", () => {
    expect(inferDefaults("tiles")).toEqual({
      zLayer: "ground",
      anchor: "top-left",
    })
  })

  it("returns background defaults", () => {
    expect(inferDefaults("backgrounds")).toEqual({
      zLayer: "background",
      anchor: "top-left",
    })
  })

  it("returns ui defaults", () => {
    expect(inferDefaults("ui")).toEqual({
      zLayer: "ui",
      anchor: "center",
    })
  })

  it("returns fallback for unknown category", () => {
    expect(inferDefaults("misc")).toEqual({
      zLayer: "entity",
      anchor: "center",
    })
  })
})

describe("AUTO_DESCRIBE_CATEGORIES", () => {
  it("includes layouts and ui", () => {
    expect(AUTO_DESCRIBE_CATEGORIES.has("layouts")).toBe(true)
    expect(AUTO_DESCRIBE_CATEGORIES.has("ui")).toBe(true)
  })

  it("does not include characters", () => {
    expect(AUTO_DESCRIBE_CATEGORIES.has("characters")).toBe(false)
  })
})
