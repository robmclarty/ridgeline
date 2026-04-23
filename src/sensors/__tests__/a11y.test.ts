import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import a11ySensor, { runA11ySensor } from "../a11y"

const fakePage = (violations: unknown[], probes: { navigated?: string[]; scriptsInjected?: string[] } = {}) => ({
  goto: async (url: string) => {
    probes.navigated?.push(url)
  },
  addScriptTag: async (opts: { path: string }) => {
    probes.scriptsInjected?.push(opts.path)
  },
  evaluate: async <R,>() => ({ violations } as unknown as R),
  close: async () => {},
})

const fakeBrowser = (page: ReturnType<typeof fakePage>) => ({
  newPage: async () => page,
  close: async () => {},
})

describe("a11y sensor", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-a11y-"))
    fs.writeFileSync(path.join(tmpDir, "shape.md"), "## Runtime\n\n- **Dev server port:** 5173\n")
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("has name 'a11y'", () => {
    expect(a11ySensor.name).toBe("a11y")
  })

  it("emits install-hint warning when playwright is unresolvable", async () => {
    const findings = await runA11ySensor(
      { cwd: tmpDir, buildDir: tmpDir },
      { isResolvable: () => false },
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe("a11y")
    expect(findings[0].severity).toBe("warning")
    expect(findings[0].summary).toContain("npm install --save-dev playwright && npx playwright install chromium")
  })

  it("injects axe-core via addScriptTag and reports zero violations as info", async () => {
    const probes: { navigated: string[]; scriptsInjected: string[] } = { navigated: [], scriptsInjected: [] }
    const page = fakePage([], probes)
    const browser = fakeBrowser(page)
    const findings = await runA11ySensor(
      { cwd: tmpDir, buildDir: tmpDir },
      {
        isResolvable: () => true,
        resolveAxePath: () => "/stub/axe-core.js",
        loadPlaywright: () =>
          ({
            chromium: { launch: async () => browser },
          }) as unknown as ReturnType<typeof import("../a11y").runA11ySensor> as never,
      },
    )
    expect(probes.navigated).toEqual(["http://127.0.0.1:5173"])
    expect(probes.scriptsInjected).toEqual(["/stub/axe-core.js"])
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("info")
    expect(findings[0].summary).toContain("no WCAG AA violations")
  })

  it("maps axe violations to SensorFinding with severity by impact", async () => {
    const violations = [
      { id: "color-contrast", impact: "serious", description: "contrast too low", help: "increase contrast", nodes: [{ target: [".btn"] }] },
      { id: "region", impact: "moderate", description: "use landmarks", nodes: [{ target: ["main"] }, { target: ["nav"] }] },
      { id: "alt-text", impact: null, description: "alt", nodes: [{ target: ["img"] }] },
    ]
    const findings = await runA11ySensor(
      { cwd: tmpDir, buildDir: tmpDir },
      {
        isResolvable: () => true,
        resolveAxePath: () => "/stub/axe-core.js",
        loadPlaywright: () =>
          ({
            chromium: { launch: async () => fakeBrowser(fakePage(violations)) },
          }) as unknown as ReturnType<typeof import("../a11y").runA11ySensor> as never,
      },
    )
    expect(findings).toHaveLength(3)
    expect(findings[0].severity).toBe("error")
    expect(findings[1].severity).toBe("warning")
    expect(findings[2].severity).toBe("info")
    expect(findings[0].summary).toContain("color-contrast")
    expect(findings[1].summary).toContain("[2 nodes]")
  })

  it("stays offline — navigates only to the localhost dev-server URL", async () => {
    const probes: { navigated: string[]; scriptsInjected: string[] } = { navigated: [], scriptsInjected: [] }
    const originalFetch = globalThis.fetch
    let fetchCalled = 0
    globalThis.fetch = (async () => {
      fetchCalled++
      throw new Error("network disabled")
    }) as typeof fetch

    try {
      await runA11ySensor(
        { cwd: tmpDir, buildDir: tmpDir },
        {
          isResolvable: () => true,
          resolveAxePath: () => "/stub/axe-core.js",
          loadPlaywright: () =>
            ({
              chromium: { launch: async () => fakeBrowser(fakePage([], probes)) },
            }) as unknown as ReturnType<typeof import("../a11y").runA11ySensor> as never,
        },
      )
      expect(fetchCalled).toBe(0)
      for (const url of probes.navigated) {
        expect(url).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):/)
      }
      for (const scriptPath of probes.scriptsInjected) {
        expect(scriptPath).not.toMatch(/^https?:/)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("emits sandbox-incompatible warning when Chromium launch fails", async () => {
    const findings = await runA11ySensor(
      { cwd: tmpDir, buildDir: tmpDir },
      {
        isResolvable: () => true,
        resolveAxePath: () => "/stub/axe-core.js",
        loadPlaywright: () =>
          ({
            chromium: {
              launch: async () => {
                throw new Error("Target page, context or browser has been closed")
              },
            },
          }) as unknown as ReturnType<typeof import("../a11y").runA11ySensor> as never,
      },
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("warning")
    expect(findings[0].summary).toContain("sandbox-incompatible")
  })

  it("emits install-hint when chromium browser is not installed", async () => {
    const findings = await runA11ySensor(
      { cwd: tmpDir, buildDir: tmpDir },
      {
        isResolvable: () => true,
        resolveAxePath: () => "/stub/axe-core.js",
        loadPlaywright: () =>
          ({
            chromium: {
              launch: async () => {
                throw new Error("Executable doesn't exist at /path; run: npx playwright install chromium")
              },
            },
          }) as unknown as ReturnType<typeof import("../a11y").runA11ySensor> as never,
      },
    )
    expect(findings[0].summary).toContain("npm install --save-dev playwright && npx playwright install chromium")
  })
})
