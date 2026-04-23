import { describe, expect, it } from "vitest"
import { renderCss } from "../css"
import { renderHtml } from "../html"
import type { DashboardSnapshot } from "../snapshot"

const fixture = (status: DashboardSnapshot["status"]): DashboardSnapshot => ({
  buildName: status === "idle" ? null : "demo",
  startedAt: status === "idle" ? null : "2026-04-22T12:00:00.000Z",
  status,
  phases: status === "idle" ? [] : [
    { id: "01-scaffold", slug: "scaffold", status: "complete", retries: 0, duration: 30_000, completedAt: "2026-04-22T12:00:30.000Z", failedAt: null },
    {
      id: "02-core",
      slug: "core",
      status: status === "running" ? "building" : status === "failed" ? "failed" : "pending",
      retries: 0,
      duration: null,
      completedAt: null,
      failedAt: status === "failed" ? "2026-04-22T12:00:45.000Z" : null,
    },
  ],
  budget: { totalCostUsd: 0.42, perRole: [{ role: "builder", costUsd: 0.42 }] },
  lastError: status === "failed" ? { phaseId: "02-core", message: "check failed" } : null,
})

const fixtures: DashboardSnapshot["status"][] = ["idle", "pending", "running", "done", "failed"]

describe("a11y — document structure", () => {
  for (const status of fixtures) {
    const html = renderHtml({ buildName: fixture(status).buildName, port: 4411, snapshot: fixture(status) })

    describe(`${status} fixture`, () => {
      it("sets html lang", () => {
        expect(html).toMatch(/<html\b[^>]*\blang="en"/)
      })

      it("has a title", () => {
        expect(html).toMatch(/<title>[^<]+<\/title>/)
      })

      it("has a landmark <main>", () => {
        expect(html).toMatch(/<main\b/)
      })

      it("has a <header>", () => {
        expect(html).toMatch(/<header\b/)
      })

      it("exactly one <h1> for the build name", () => {
        const h1s = html.match(/<h1\b/g) ?? []
        expect(h1s.length).toBe(1)
      })

      it("no autofocus on any control", () => {
        expect(html).not.toMatch(/\bautofocus\b/)
      })

      it("disconnect banner uses role='status' for live region semantics", () => {
        expect(html).toMatch(/id="disconnect-banner"[^>]*role="status"[^>]*aria-live="polite"/)
      })

      it("decorative spinner dot is hidden from AT", () => {
        expect(html).toMatch(/class="spinner-dot"[^>]*aria-hidden="true"/)
      })
    })
  }
})

describe("a11y — CSS focus ring present", () => {
  const css = renderCss()
  it("has a visible focus ring of 2px info-cyan at 2px offset", () => {
    expect(css).toMatch(/focus-visible[\s\S]*?outline:\s*2px solid var\(--info\)/)
    expect(css).toContain("outline-offset: 2px")
  })
})
