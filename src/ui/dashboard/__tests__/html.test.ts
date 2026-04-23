import { describe, expect, it } from "vitest"
import { renderHtml } from "../html"
import type { DashboardSnapshot } from "../snapshot"

const emptySnap: DashboardSnapshot = {
  buildName: null,
  startedAt: null,
  status: "idle",
  phases: [],
  budget: { totalCostUsd: 0, perRole: [] },
  lastError: null,
}

const attachedSnap = (status: DashboardSnapshot["status"]): DashboardSnapshot => ({
  buildName: "demo",
  startedAt: "2026-04-22T12:00:00.000Z",
  status,
  phases: [
    {
      id: "01-scaffold",
      slug: "scaffold",
      status: "complete",
      retries: 0,
      duration: 30_000,
      completedAt: "2026-04-22T12:00:30.000Z",
      failedAt: null,
    },
    {
      id: "02-core",
      slug: "core",
      status: status === "failed" ? "failed" : "building",
      retries: 0,
      duration: null,
      completedAt: null,
      failedAt: status === "failed" ? "2026-04-22T12:00:40.000Z" : null,
    },
  ],
  budget: { totalCostUsd: 1.25, perRole: [{ role: "builder", costUsd: 0.75 }, { role: "reviewer", costUsd: 0.5 }] },
  lastError: status === "failed" ? { phaseId: "02-core", message: "check command failed" } : null,
})

describe("renderHtml", () => {
  it("empty state contains required copy and port URL", () => {
    const html = renderHtml({ buildName: null, port: 4411, snapshot: emptySnap })
    expect(html).toContain("No build attached. Run")
    expect(html).toContain(`http://127.0.0.1:4411`)
    expect(html).toContain("<title>● ridgeline")
  })

  it("attached running state includes lowercase wordmark", () => {
    const html = renderHtml({ buildName: "demo", port: 4411, snapshot: attachedSnap("running") })
    expect(html).toMatch(/class="wordmark">ridgeline<\/span>/)
    expect(html).toContain("<title>● ridgeline · demo · running")
  })

  it("inlines a favicon data URI SVG that updates per status", () => {
    const run = renderHtml({ buildName: "demo", port: 4411, snapshot: attachedSnap("running") })
    const done = renderHtml({ buildName: "demo", port: 4411, snapshot: attachedSnap("done") })
    const failed = renderHtml({ buildName: "demo", port: 4411, snapshot: attachedSnap("failed") })
    expect(run).toMatch(/id="favicon"[^>]*href="data:image\/svg\+xml;utf8,/)
    expect(run).toContain(encodeURIComponent("#06B6D4"))
    expect(done).toContain(encodeURIComponent("#10B981"))
    expect(failed).toContain(encodeURIComponent("#EF4444"))
  })

  it("does not reference any remote origins (http://... except local or https://...)", () => {
    const html = renderHtml({ buildName: "demo", port: 4411, snapshot: attachedSnap("running") })
    const matches = html.match(/https?:\/\/[^\s"'>]+/g) ?? []
    for (const m of matches) {
      const allowed = m.startsWith("http://127.0.0.1") || m.startsWith("http://www.w3.org") // SVG xmlns
      expect(allowed).toBe(true)
    }
  })

  it("uses CSS variable-driven design tokens and includes #0B0F14 page background", () => {
    const html = renderHtml({ buildName: "demo", port: 4411, snapshot: attachedSnap("running") })
    expect(html).toContain("#0B0F14")
    expect(html).toContain("--bg: #0B0F14")
    expect(html).toContain("background: var(--bg)")
  })

  it("contains no inline @font-face, no external stylesheet links", () => {
    const html = renderHtml({ buildName: "demo", port: 4411, snapshot: attachedSnap("running") })
    expect(html).not.toContain("@font-face")
    expect(html).not.toMatch(/<link\b[^>]+rel=["']stylesheet["']/)
  })
})
