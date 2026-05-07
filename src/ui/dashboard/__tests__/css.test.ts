import { describe, expect, it } from "vitest"
import { renderCss } from "../css.js"
import { PALETTE } from "../tokens.js"

describe("renderCss", () => {
  const css = renderCss()

  it("defines CSS custom properties on :root for all tokens", () => {
    for (const [, hex] of Object.entries(PALETTE)) expect(css).toContain(hex)
    for (const token of [
      "--bg",
      "--panel",
      "--border",
      "--text",
      "--text-dim",
      "--error",
      "--success",
      "--warning",
      "--info",
    ]) {
      expect(css).toContain(`${token}:`)
    }
  })

  it("hex values appear only inside the :root block", () => {
    const rootMatch = css.match(/:root\s*{([^}]*)}/)!
    expect(rootMatch).toBeTruthy()
    const rootContent = rootMatch[1]
    const outsideRoot = css.slice(0, rootMatch.index!) + css.slice(rootMatch.index! + rootMatch[0].length)
    const hexPattern = /#[0-9A-Fa-f]{3,8}\b/g
    const outsideHexes = outsideRoot.match(hexPattern) ?? []
    const inRootHexes = rootContent.match(hexPattern) ?? []
    expect(inRootHexes.length).toBeGreaterThan(0)
    expect(outsideHexes).toEqual([])
  })

  it("no drop shadows, no gradients, no pure-black backgrounds", () => {
    expect(css).not.toMatch(/box-shadow\s*:\s*(?!none)/)
    expect(css).not.toMatch(/linear-gradient|radial-gradient/)
    expect(css).not.toMatch(/#000\b|#000000\b|background[^;]*:\s*black\b/)
  })

  it("uses exactly the 12/13/14/16/20 px font-size scale", () => {
    const sizes = (css.match(/font-size:\s*(\d+)px/g) ?? [])
      .map((s) => parseInt(s.match(/(\d+)/)![1], 10))
    const allowed = new Set([11, 12, 13, 14, 16, 20])
    for (const s of sizes) expect(allowed.has(s)).toBe(true)
    expect(sizes.length).toBeGreaterThan(0)
  })

  it("uses the required sans and mono font stacks", () => {
    expect(css).toContain("-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif")
    expect(css).toContain("ui-monospace, 'SF Mono', Menlo, Consolas, monospace")
  })

  it("no @font-face declarations", () => {
    expect(css).not.toContain("@font-face")
  })

  it("panels use 4px radius and 1px solid border, no box-shadow", () => {
    expect(css).toContain("border-radius: 4px")
    expect(css).toContain("border: 1px solid var(--border)")
    expect(css).not.toMatch(/box-shadow:\s*[^n]/)
  })

  it("pill-running animates opacity pulse 1500ms ease-in-out infinite", () => {
    expect(css).toMatch(/\.pill-running\s*{[^}]*animation:\s*pill-pulse\s+1500ms\s+ease-in-out\s+infinite/)
  })

  it("row-flash animation is 300ms", () => {
    expect(css).toMatch(/\.row-flash\s*{[^}]*animation:\s*row-flash\s+300ms/)
  })

  it("disconnect-banner fade-out is 400ms", () => {
    expect(css).toMatch(/\.fade-out\s*{[^}]*animation:\s*banner-fade\s+400ms/)
  })

  it("exactly three @keyframes declarations exist", () => {
    const keyframes = css.match(/@keyframes\s+[a-z-]+/g) ?? []
    expect(keyframes).toHaveLength(3)
  })

  it("prefers-reduced-motion block disables pulse with static info-cyan border", () => {
    const rmMatch = css.match(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*{([\s\S]*?)}\s*\n?\s*@media/)
    const rm = rmMatch ? rmMatch[1] : css.split("@media (prefers-reduced-motion: reduce)")[1] ?? ""
    expect(rm).toContain(".pill-running")
    expect(rm).toMatch(/animation:\s*none/)
    expect(rm).toMatch(/border:\s*2px solid var\(--info\)/)
  })

  it("no transform translate/scale/rotate animations", () => {
    expect(css).not.toMatch(/transform:\s*translate/)
    expect(css).not.toMatch(/transform:\s*scale/)
    expect(css).not.toMatch(/transform:\s*rotate/)
  })

  it("focus-visible has 2px solid info with 2px offset", () => {
    expect(css).toMatch(/outline:\s*2px solid var\(--info\)/)
    expect(css).toMatch(/outline-offset:\s*2px/)
  })

  it("pill padding is 4px 8px", () => {
    expect(css).toMatch(/\.pill\s*{[^}]*padding:\s*4px\s+8px/)
  })

  it("max content width is 1280px", () => {
    expect(css).toContain("max-width: 1280px")
  })
})
