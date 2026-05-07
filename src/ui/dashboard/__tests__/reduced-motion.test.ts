import { describe, expect, it } from "vitest"
import { renderCss } from "../css.js"

describe("prefers-reduced-motion", () => {
  const css = renderCss()

  const rmStart = css.indexOf("@media (prefers-reduced-motion: reduce)")
  const reducedMotionBlock = (() => {
    if (rmStart < 0) return ""
    let depth = 0
    let i = css.indexOf("{", rmStart)
    const start = i + 1
    depth = 1
    i++
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++
      else if (css[i] === "}") depth--
      i++
    }
    return css.slice(start, i - 1)
  })()

  it("replaces pill-running pulse with a static 2px info-cyan border (no active animation)", () => {
    expect(reducedMotionBlock).toContain(".pill-running")
    expect(reducedMotionBlock).toMatch(/animation:\s*none/)
    expect(reducedMotionBlock).toMatch(/border:\s*2px solid var\(--info\)/)
  })

  it("disables row-flash animation", () => {
    expect(reducedMotionBlock).toMatch(/\.phase-row\.row-flash[\s\S]*?animation:\s*none/)
  })

  it("disables spinner dot pulse", () => {
    expect(reducedMotionBlock).toMatch(/\.spinner-dot[\s\S]*?animation:\s*none/)
  })
})
