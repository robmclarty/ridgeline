import { describe, it, expect } from "vitest"
import { parseRequiredViews } from "../phase.sequence"

describe("parseRequiredViews", () => {
  it("returns an empty array when the section is absent", () => {
    expect(parseRequiredViews("# Phase\n\n## Goal\n\ntext\n")).toEqual([])
  })

  it("parses bare labels without attributes", () => {
    const md = [
      "## Required Views",
      "",
      "- canvas-default",
      "- node-zoomed-in",
    ].join("\n")
    expect(parseRequiredViews(md)).toEqual([
      { label: "canvas-default" },
      { label: "node-zoomed-in" },
    ])
  })

  it("parses labels with viewport attribute", () => {
    const md = "## Required Views\n\n- canvas: 1280x800\n"
    expect(parseRequiredViews(md)).toEqual([
      { label: "canvas", viewport: { width: 1280, height: 800 } },
    ])
  })

  it("parses labels with zoom attribute", () => {
    const md = "## Required Views\n\n- node-zoomed: zoom 2.0\n"
    expect(parseRequiredViews(md)).toEqual([{ label: "node-zoomed", zoom: 2.0 }])
  })

  it("parses labels with url attribute", () => {
    const md = "## Required Views\n\n- detail: url /flow/hello\n"
    expect(parseRequiredViews(md)).toEqual([{ label: "detail", url: "/flow/hello" }])
  })

  it("parses combined attributes in any order", () => {
    const md = [
      "## Required Views",
      "",
      "- canvas-default: 1280x800, url /, zoom 1.0",
      "- node-zoomed-in: zoom 2.0, 1280x800, url /flow/hello",
    ].join("\n")
    expect(parseRequiredViews(md)).toEqual([
      { label: "canvas-default", viewport: { width: 1280, height: 800 }, url: "/", zoom: 1.0 },
      { label: "node-zoomed-in", viewport: { width: 1280, height: 800 }, url: "/flow/hello", zoom: 2.0 },
    ])
  })

  it("ignores list items with empty labels", () => {
    const md = "## Required Views\n\n- : 1280x800\n- canvas\n"
    expect(parseRequiredViews(md)).toEqual([{ label: "canvas" }])
  })

  it("supports asterisk and numbered list markers", () => {
    const md = "## Required Views\n\n* a\n1. b\n2) c\n"
    expect(parseRequiredViews(md)).toEqual([
      { label: "a" },
      { label: "b" },
      { label: "c" },
    ])
  })

  it("stops at the next H2", () => {
    const md = "## Required Views\n- canvas\n\n## Goal\n- ignored\n"
    expect(parseRequiredViews(md)).toEqual([{ label: "canvas" }])
  })

  it("strips backticks around labels", () => {
    const md = "## Required Views\n\n- `canvas-default`: 800x600\n"
    expect(parseRequiredViews(md)).toEqual([
      { label: "canvas-default", viewport: { width: 800, height: 600 } },
    ])
  })
})
