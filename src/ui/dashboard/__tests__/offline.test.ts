import { describe, expect, it } from "vitest"
import { renderHtml } from "../html"
import type { DashboardSnapshot } from "../snapshot"

const snap: DashboardSnapshot = {
  buildName: "demo",
  startedAt: "2026-04-22T12:00:00.000Z",
  status: "running",
  phases: [
    { id: "01-scaffold", slug: "scaffold", status: "complete", retries: 0, duration: 30_000, completedAt: null, failedAt: null },
  ],
  budget: { totalCostUsd: 0.25, perRole: [{ role: "builder", costUsd: 0.25 }] },
  lastError: null,
}

describe("offline guarantee", () => {
  const html = renderHtml({ buildName: "demo", port: 4411, snapshot: snap })

  it("no remote stylesheet links", () => {
    expect(html).not.toMatch(/<link\b[^>]+rel=["']stylesheet["']/)
  })

  it("no script src attributes (inline script only)", () => {
    expect(html).not.toMatch(/<script\b[^>]*\bsrc=/)
  })

  it("no google fonts, typekit, CDN, or analytics references", () => {
    const banned = [
      "fonts.googleapis",
      "fonts.gstatic",
      "use.typekit",
      "cdn.jsdelivr",
      "unpkg.com",
      "google-analytics",
      "googletagmanager",
      "plausible",
      "segment.com",
      "mixpanel",
    ]
    for (const token of banned) expect(html).not.toContain(token)
  })

  it("all http(s) URLs are either 127.0.0.1 or w3.org SVG namespaces", () => {
    const matches = html.match(/https?:\/\/[^\s"'>]+/g) ?? []
    for (const m of matches) {
      const allowed = m.startsWith("http://127.0.0.1") || m.startsWith("http://www.w3.org")
      expect(allowed, `disallowed URL: ${m}`).toBe(true)
    }
  })

  it("no webfont @font-face declarations", () => {
    expect(html).not.toContain("@font-face")
  })
})
