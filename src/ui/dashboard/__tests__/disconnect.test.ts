import { describe, expect, it } from "vitest"
import { renderClientScript } from "../client"
import { renderCss } from "../css"
import { renderHtml } from "../html"
import { buildSnapshot } from "../snapshot"
import type { BuildState, BudgetState } from "../../../types"

const STATE: BuildState = {
  buildName: "demo",
  startedAt: "2026-04-22T12:00:00.000Z",
  pipeline: {
    shape: "complete",
    design: "skipped",
    spec: "complete",
    research: "skipped",
    refine: "skipped",
    plan: "complete",
    build: "running",
  },
  phases: [],
}
const BUDGET: BudgetState = { entries: [], totalCostUsd: 0 }

describe("dashboard disconnected state", () => {
  const snapshot = buildSnapshot("demo", STATE, BUDGET, [])
  const html = renderHtml({ buildName: "demo", port: 4411, snapshot })
  const css = renderCss()
  const client = renderClientScript()

  it("renders a sticky disconnect banner that starts hidden", () => {
    expect(html).toMatch(
      /<div id="disconnect-banner"[^>]*class="[^"]*\bdisconnect-banner\b[^"]*\bhidden\b/,
    )
  })

  it("banner uses role=status and aria-live=polite for a polite live region", () => {
    expect(html).toMatch(
      /id="disconnect-banner"[^>]*role="status"[^>]*aria-live="polite"/,
    )
  })

  it("banner carries the 'Disconnected … Retrying…' copy", () => {
    expect(html).toContain("Disconnected from ridgeline process. Retrying")
  })

  it("banner spinner dot is aria-hidden so the live text reads cleanly", () => {
    expect(html).toMatch(/<span class="spinner-dot" aria-hidden="true">/)
  })

  it("CSS styles the banner with warning colors, sticky position, and 1px warning border", () => {
    expect(css).toMatch(
      /\.disconnect-banner\s*{[^}]*position:\s*sticky/,
    )
    expect(css).toMatch(
      /\.disconnect-banner\s*{[^}]*background:\s*var\(--banner-fill\)/,
    )
    expect(css).toMatch(
      /\.disconnect-banner\s*{[^}]*border:\s*1px solid var\(--warning\)/,
    )
  })

  it("CSS fade-out animation is 400ms per the motion budget", () => {
    expect(css).toMatch(
      /\.disconnect-banner\.fade-out\s*{[^}]*animation:\s*banner-fade\s+400ms/,
    )
  })

  it("CSS hides the banner under prefers-reduced-motion (no active fade)", () => {
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)")
    expect(start).toBeGreaterThan(-1)
    let depth = 0
    let i = css.indexOf("{", start)
    const bodyStart = i + 1
    depth = 1
    i++
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++
      else if (css[i] === "}") depth--
      i++
    }
    const body = css.slice(bodyStart, i - 1)
    expect(body).toMatch(/\.disconnect-banner\.fade-out[\s\S]*?animation:\s*none/)
  })

  it("client script shows the banner and starts 2s polling on SSE error", () => {
    expect(client).toContain(`es.addEventListener("error"`)
    expect(client).toMatch(/disconnected\s*=\s*true[\s\S]{0,80}showBanner\(\)[\s\S]{0,80}startPolling\(\)/)
    expect(client).toMatch(/setInterval\(function \(\) \{[\s\S]*?fetch\("\/state"\)[\s\S]*?\}, 2000\)/)
  })

  it("client script fades the banner out and stops polling when SSE reconnects", () => {
    expect(client).toContain(`es.addEventListener("open"`)
    expect(client).toMatch(/disconnected\s*=\s*false[\s\S]{0,80}hideBanner\(\)[\s\S]{0,80}stopPolling\(\)/)
    expect(client).toMatch(/fade-out[\s\S]*?setTimeout\(function \(\) \{[\s\S]*?hidden/)
  })
})
