import { describe, it, expect } from "vitest"
import { parseRequiredTools } from "../../build-phase.js"

describe("parseRequiredTools", () => {
  it("returns an empty array when the section is absent", () => {
    expect(parseRequiredTools("# Phase\n\nGoal: do thing\n")).toEqual([])
  })

  it("parses dash-bulleted tool names", () => {
    const md = [
      "# Phase 03",
      "",
      "## Required Tools",
      "",
      "- playwright",
      "- agent-browser",
      "",
      "## Goal",
      "",
      "Render UI.",
    ].join("\n")
    expect(parseRequiredTools(md)).toEqual(["playwright", "agent-browser"])
  })

  it("normalizes case and strips backticks", () => {
    const md = "## Required Tools\n\n- `Playwright`\n- AGENT-BROWSER\n"
    expect(parseRequiredTools(md)).toEqual(["playwright", "agent-browser"])
  })

  it("supports asterisk and numbered list markers", () => {
    const md = "## Required Tools\n\n* one\n1. two\n2) three\n"
    expect(parseRequiredTools(md)).toEqual(["one", "two", "three"])
  })

  it("stops at the next H2", () => {
    const md = "## Required Tools\n- a\n\n## Goal\n- ignored\n"
    expect(parseRequiredTools(md)).toEqual(["a"])
  })
})
