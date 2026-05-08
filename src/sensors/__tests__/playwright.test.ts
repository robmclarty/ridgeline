import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import playwrightSensor, {
  parsePortFromShape,
  PROBE_PORTS,
  probeDevServer,
  resolveDevServerPort,
  runPlaywrightSensor,
  sanitizeViewLabel,
} from "../playwright.js"

describe("parsePortFromShape", () => {
  it("extracts the port from a ## Runtime block", () => {
    const content = [
      "# My build",
      "",
      "## Runtime",
      "",
      "- **Dev server port:** 5173",
      "",
      "## Something else",
    ].join("\n")
    expect(parsePortFromShape(content)).toEqual({ port: 5173, malformed: false })
  })

  it("returns null port (not malformed) when no ## Runtime section is present", () => {
    const content = "# title\n\n## Intent\n\nplain content\n"
    expect(parsePortFromShape(content)).toEqual({ port: null, malformed: false })
  })

  it("returns null port (not malformed) when Runtime exists but has no port line", () => {
    const content = "# title\n\n## Runtime\n\n- **Other:** stuff\n"
    expect(parsePortFromShape(content)).toEqual({ port: null, malformed: false })
  })

  it("marks out-of-range ports as malformed", () => {
    const content = "## Runtime\n\n- **Dev server port:** 70000\n"
    expect(parsePortFromShape(content)).toEqual({ port: null, malformed: true })
  })

  it("marks multiple Runtime sections as malformed", () => {
    const content = [
      "## Runtime",
      "",
      "- **Dev server port:** 5173",
      "",
      "## Runtime",
      "",
      "- **Dev server port:** 3000",
    ].join("\n")
    expect(parsePortFromShape(content)).toEqual({ port: null, malformed: true })
  })

  it("marks multiple port declarations in one Runtime as malformed", () => {
    const content = [
      "## Runtime",
      "",
      "- **Dev server port:** 5173",
      "- **Dev server port:** 3000",
    ].join("\n")
    expect(parsePortFromShape(content)).toEqual({ port: null, malformed: true })
  })
})

describe("probeDevServer", () => {
  it("probes exactly the four canonical ports in order", async () => {
    const attempts: number[] = []
    const { port, attempts: returned } = await probeDevServer({
      probe: async (p) => {
        attempts.push(p)
        return false
      },
      timeoutPerProbeMs: 10,
      totalTimeoutMs: 1000,
    })
    expect(port).toBeNull()
    expect(attempts).toEqual([...PROBE_PORTS])
    expect(returned).toEqual([...PROBE_PORTS])
  })

  it("short-circuits on first successful probe", async () => {
    const attempts: number[] = []
    const { port, attempts: returned } = await probeDevServer({
      probe: async (p) => {
        attempts.push(p)
        return p === 3000
      },
      timeoutPerProbeMs: 10,
    })
    expect(port).toBe(3000)
    expect(attempts).toEqual([5173, 3000])
    expect(returned).toEqual([5173, 3000])
  })

  it("never probes ports outside the canonical list", async () => {
    const { port } = await probeDevServer({
      probe: async (p) => ![5173, 3000, 8080, 4321].includes(p),
      timeoutPerProbeMs: 10,
    })
    expect(port).toBeNull()
  })

  it("respects the total timeout cap", async () => {
    const attempts: number[] = []
    const { attempts: returned } = await probeDevServer({
      probe: async (p) => {
        attempts.push(p)
        await new Promise((r) => setTimeout(r, 60))
        return false
      },
      timeoutPerProbeMs: 60,
      totalTimeoutMs: 100,
    })
    expect(returned.length).toBeLessThan(PROBE_PORTS.length)
  })
})

describe("resolveDevServerPort", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-pwt-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("uses shape.md port directly without probing when match is valid", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "shape.md"),
      "## Runtime\n\n- **Dev server port:** 4321\n",
    )
    let probed = false
    const result = await resolveDevServerPort(
      { cwd: tmpDir, buildDir: tmpDir },
      {
        probe: async () => {
          probed = true
          return true
        },
      },
    )
    expect(result.source).toBe("shape-md")
    if (result.source === "shape-md") {
      expect(result.port).toBe(4321)
    }
    expect(probed).toBe(false)
  })

  it("falls back to probing when shape.md has no Runtime block", async () => {
    fs.writeFileSync(path.join(tmpDir, "shape.md"), "# title\nno runtime here\n")
    const result = await resolveDevServerPort(
      { cwd: tmpDir, buildDir: tmpDir },
      {
        probe: async (p) => p === 8080,
        timeoutPerProbeMs: 10,
      },
    )
    expect(result.source).toBe("probe")
    if (result.source === "probe") {
      expect(result.port).toBe(8080)
      expect(result.attempts).toEqual([5173, 3000, 8080])
    }
  })

  it("returns source 'none' when probing fails", async () => {
    const result = await resolveDevServerPort(
      { cwd: tmpDir, buildDir: tmpDir },
      { probe: async () => false, timeoutPerProbeMs: 10 },
    )
    expect(result.source).toBe("none")
  })

  it("logs a warning and falls back to probing for malformed port", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "shape.md"),
      "## Runtime\n\n- **Dev server port:** 99999\n",
    )
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = await resolveDevServerPort(
      { cwd: tmpDir, buildDir: tmpDir },
      { probe: async () => true, timeoutPerProbeMs: 10 },
    )
    expect(result.source).toBe("probe")
    expect(stderrSpy.mock.calls.some((c) => String(c[0]).includes("malformed dev-server port"))).toBe(true)
    stderrSpy.mockRestore()
  })
})

describe("runPlaywrightSensor (stubbed)", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-pwt-run-"))
    fs.writeFileSync(path.join(tmpDir, "shape.md"), "## Runtime\n\n- **Dev server port:** 5173\n")
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("emits install-hint warning when playwright is unresolvable", async () => {
    const findings = await runPlaywrightSensor(
      { cwd: tmpDir, buildDir: tmpDir },
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("warning")
    expect(findings[0].summary).toContain("npm install --save-dev playwright && npx playwright install chromium")
  })

  it("emits sandbox-incompatible warning when Chromium launch times out", async () => {
    const findings = await runPlaywrightSensor(
      { cwd: tmpDir, buildDir: tmpDir },
      {
        isResolvable: () => true,
        loadPlaywright: () => ({
          chromium: {
            launch: (opts: { timeout?: number }) =>
              new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Timeout exceeded")), opts.timeout ?? 10)
              }),
          },
        }) as unknown as ReturnType<typeof import("../playwright.js").runPlaywrightSensor> as never,
        launchTimeoutMs: 50,
      },
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("warning")
    expect(findings[0].summary).toContain("sandbox-incompatible")
  })

  it("emits 'no dev server detected' warning when probing fails", async () => {
    fs.rmSync(path.join(tmpDir, "shape.md"))
    const findings = await runPlaywrightSensor(
      { cwd: tmpDir, buildDir: tmpDir },
      {
        isResolvable: () => true,
        probeOptions: { probe: async () => false, timeoutPerProbeMs: 5 },
      },
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("warning")
    expect(findings[0].summary).toContain("no dev server detected")
  })

  it("has name 'playwright' and default export", () => {
    expect(playwrightSensor.name).toBe("playwright")
    expect(typeof playwrightSensor.run).toBe("function")
  })
})

describe("sandbox launch args", () => {
  it("uses --no-sandbox flags when sandbox is detected", async () => {
    const capturedArgs: string[][] = []
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-pwt-sbx-"))
    fs.writeFileSync(path.join(tmp, "shape.md"), "## Runtime\n\n- **Dev server port:** 5173\n")
    try {
      await runPlaywrightSensor(
        { cwd: tmp, buildDir: tmp },
        {
          isResolvable: () => true,
          isSandboxed: () => true,
          loadPlaywright: () => ({
            chromium: {
              launch: async (opts: { args?: string[] }) => {
                capturedArgs.push(opts.args ?? [])
                throw new Error("stub — not launching")
              },
            },
          }) as unknown as ReturnType<typeof import("../playwright.js").runPlaywrightSensor> as never,
        },
      )
      expect(capturedArgs).toHaveLength(1)
      expect(capturedArgs[0]).toEqual(["--no-sandbox", "--disable-setuid-sandbox"])
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("omits sandbox args when not sandboxed", async () => {
    const capturedArgs: string[][] = []
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-pwt-nosbx-"))
    fs.writeFileSync(path.join(tmp, "shape.md"), "## Runtime\n\n- **Dev server port:** 5173\n")
    try {
      await runPlaywrightSensor(
        { cwd: tmp, buildDir: tmp },
        {
          isResolvable: () => true,
          isSandboxed: () => false,
          loadPlaywright: () => ({
            chromium: {
              launch: async (opts: { args?: string[] }) => {
                capturedArgs.push(opts.args ?? [])
                throw new Error("stub — not launching")
              },
            },
          }) as unknown as ReturnType<typeof import("../playwright.js").runPlaywrightSensor> as never,
        },
      )
      expect(capturedArgs[0]).toEqual([])
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe("sanitizeViewLabel", () => {
  it("lowercases and replaces non-alphanumeric runs with single dashes", () => {
    expect(sanitizeViewLabel("Canvas Default")).toBe("canvas-default")
    expect(sanitizeViewLabel("Node_Zoomed-IN!")).toBe("node-zoomed-in")
  })

  it("trims leading and trailing dashes", () => {
    expect(sanitizeViewLabel("--foo--")).toBe("foo")
  })

  it("falls back to 'view' for empty or fully-stripped labels", () => {
    expect(sanitizeViewLabel("")).toBe("view")
    expect(sanitizeViewLabel("!!!")).toBe("view")
  })
})

describe("runPlaywrightSensor view options", () => {
  let tmpDir: string
  const startStubServer = () => {
    const created: { capturedViewport: { width: number; height: number } | null; capturedEvalArgs: unknown[]; screenshotPath: string | null } = {
      capturedViewport: null,
      capturedEvalArgs: [],
      screenshotPath: null,
    }
    const stubPlaywright = {
      chromium: {
        launch: async () => ({
          newPage: async () => ({
            setViewportSize: async (size: { width: number; height: number }) => {
              created.capturedViewport = size
            },
            goto: async () => {},
            evaluate: async (fn: unknown) => {
              created.capturedEvalArgs.push(fn)
            },
            screenshot: async (opts: { path: string }) => {
              created.screenshotPath = opts.path
              fs.writeFileSync(opts.path, "stub-png")
            },
            close: async () => {},
            addScriptTag: async () => {},
          }),
          close: async () => {},
        }),
      },
    }
    return { stubPlaywright, created }
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-pwt-views-"))
    fs.writeFileSync(path.join(tmpDir, "shape.md"), "## Runtime\n\n- **Dev server port:** 5173\n")
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("includes the sanitized view label in the screenshot filename", async () => {
    const { stubPlaywright, created } = startStubServer()
    const findings = await runPlaywrightSensor(
      { cwd: tmpDir, buildDir: tmpDir, viewLabel: "Canvas Default" },
      {
        isResolvable: () => true,
        loadPlaywright: () => stubPlaywright as never,
      },
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].path).toMatch(/screenshot-canvas-default-\d+\.png$/)
    expect(created.screenshotPath).toBe(findings[0].path)
  })

  it("applies viewport when provided", async () => {
    const { stubPlaywright, created } = startStubServer()
    await runPlaywrightSensor(
      {
        cwd: tmpDir,
        buildDir: tmpDir,
        viewLabel: "wide",
        viewport: { width: 1920, height: 1080 },
      },
      {
        isResolvable: () => true,
        loadPlaywright: () => stubPlaywright as never,
      },
    )
    expect(created.capturedViewport).toEqual({ width: 1920, height: 1080 })
  })

  it("evaluates a zoom assignment when zoom is set and not 1", async () => {
    const { stubPlaywright, created } = startStubServer()
    await runPlaywrightSensor(
      { cwd: tmpDir, buildDir: tmpDir, zoom: 2.0 },
      {
        isResolvable: () => true,
        loadPlaywright: () => stubPlaywright as never,
      },
    )
    expect(created.capturedEvalArgs).toHaveLength(1)
    expect(String(created.capturedEvalArgs[0])).toContain("document.body.style.zoom")
    expect(String(created.capturedEvalArgs[0])).toContain('"2"')
  })

  it("skips zoom evaluation when zoom is 1 or unset", async () => {
    const { stubPlaywright, created } = startStubServer()
    await runPlaywrightSensor(
      { cwd: tmpDir, buildDir: tmpDir, zoom: 1 },
      {
        isResolvable: () => true,
        loadPlaywright: () => stubPlaywright as never,
      },
    )
    expect(created.capturedEvalArgs).toHaveLength(0)
  })

  it("uses the provided url instead of the dev-server origin", async () => {
    const { stubPlaywright } = startStubServer()
    const findings = await runPlaywrightSensor(
      { cwd: tmpDir, buildDir: tmpDir, url: "http://example.test/path" },
      {
        isResolvable: () => true,
        loadPlaywright: () => stubPlaywright as never,
      },
    )
    expect(findings[0].summary).toContain("http://example.test/path")
  })
})
