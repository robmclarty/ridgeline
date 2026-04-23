import { PassThrough, Writable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DetectionReport } from "../../engine/detect"
import { renderPreflight, runPreflight } from "../preflight"
import { stripAnsi } from "../color"

const ESC = String.fromCharCode(27)
const BOX_DRAWING = /[─-╿]/

const visualReport: DetectionReport = {
  projectType: "web",
  isVisualSurface: true,
  detectedDeps: ["react", "vite"],
  hasDesignMd: true,
  hasAssetDir: false,
  suggestedSensors: ["playwright", "vision", "a11y", "contrast"],
  suggestedEnsembleSize: 2,
}

const nodeReport: DetectionReport = {
  projectType: "node",
  isVisualSurface: false,
  detectedDeps: [],
  hasDesignMd: false,
  hasAssetDir: false,
  suggestedSensors: [],
  suggestedEnsembleSize: 2,
}

const captureWritable = (): { stream: Writable; chunks: string[] } => {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString())
      cb()
    },
  })
  return { stream, chunks }
}

describe("preflight", () => {
  let originalNoColor: string | undefined
  let originalStdoutIsTTY: boolean | undefined

  beforeEach(() => {
    originalNoColor = process.env.NO_COLOR
    originalStdoutIsTTY = process.stdout.isTTY
    delete process.env.NO_COLOR
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true })
  })

  afterEach(() => {
    if (originalNoColor === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = originalNoColor
    Object.defineProperty(process.stdout, "isTTY", { value: originalStdoutIsTTY, writable: true })
  })

  describe("rendering", () => {
    it("renders the three required label lines in order", () => {
      const out = renderPreflight(visualReport, { isTTY: true, yes: true })
      const stripped = stripAnsi(out)
      const lines = stripped.split("\n")
      expect(lines[0]).toMatch(/^Detected\s+react,\s*vite,\s*design\.md\s+→\s+enabling\s+Playwright,\s*vision,\s*pa11y,\s*contrast$/)
      expect(lines[1]).toBe("")
      expect(lines[2]).toMatch(/^Ensemble\s+2 specialists\s+\(use --thorough for 3\)$/)
      expect(lines[3]).toMatch(/^Caching\s+on$/)
    })

    it("contains no Unicode box-drawing characters", () => {
      const out = renderPreflight(visualReport, { isTTY: true, yes: false })
      expect(BOX_DRAWING.test(out)).toBe(false)
    })

    it("uses bold for labels and dim for values", () => {
      const out = renderPreflight(visualReport, { isTTY: true, yes: true })
      // Bold is SGR 1, dim is SGR 2
      expect(out).toContain(`${ESC}[1mDetected${ESC}[0m`)
      expect(out).toContain(`${ESC}[1menabling${ESC}[0m`)
      expect(out).toContain(`${ESC}[1mEnsemble${ESC}[0m`)
      expect(out).toContain(`${ESC}[1mCaching${ESC}[0m`)
      expect(out).toContain(`${ESC}[2mreact, vite, design.md${ESC}[0m`)
    })

    it("renders the arrow in dim cyan (SGR 2;36)", () => {
      const out = renderPreflight(visualReport, { isTTY: true, yes: true })
      expect(out).toContain(`${ESC}[2;36m→${ESC}[0m`)
    })

    it("appends the CI auto-proceed suffix when not a TTY", () => {
      const out = renderPreflight(visualReport, { isTTY: false, yes: false })
      expect(stripAnsi(out)).toContain("(auto-proceeding in CI)")
      expect(stripAnsi(out)).not.toContain("Press Enter")
    })

    it("emits the Press Enter prompt indented exactly 2 spaces in TTY interactive mode", () => {
      const out = renderPreflight(visualReport, { isTTY: true, yes: false })
      const stripped = stripAnsi(out)
      expect(stripped).toContain("\n  Press Enter to continue, Ctrl+C to abort")
      expect(stripped).not.toContain("(auto-proceeding in CI)")
    })

    it("omits both the prompt and the CI suffix when --yes in TTY mode", () => {
      const out = renderPreflight(visualReport, { isTTY: true, yes: true })
      const stripped = stripAnsi(out)
      expect(stripped).not.toContain("Press Enter")
      expect(stripped).not.toContain("(auto-proceeding in CI)")
    })

    it("omits the --thorough hint when ensemble size is already 3", () => {
      const thoroughReport: DetectionReport = { ...visualReport, suggestedEnsembleSize: 3 }
      const out = renderPreflight(thoroughReport, { isTTY: true, yes: true })
      const stripped = stripAnsi(out)
      expect(stripped).toContain("3 specialists")
      expect(stripped).not.toContain("--thorough")
    })

    it("renders a fallback for projects with no signals", () => {
      const out = renderPreflight(nodeReport, { isTTY: true, yes: true })
      const stripped = stripAnsi(out)
      expect(stripped).toContain("no project signals")
      expect(stripped).toContain("no sensors")
    })

    it("renders without color when NO_COLOR is set", () => {
      process.env.NO_COLOR = "1"
      const out = renderPreflight(visualReport, { isTTY: true, yes: true })
      // No ANSI escape sequences should be present
      expect(out).toBe(stripAnsi(out))
    })
  })

  describe("snapshots", () => {
    it("matches the TTY interactive rendering snapshot", () => {
      const out = renderPreflight(visualReport, { isTTY: true, yes: false })
      expect(stripAnsi(out)).toMatchSnapshot()
    })

    it("matches the --yes rendering snapshot", () => {
      const out = renderPreflight(visualReport, { isTTY: true, yes: true })
      expect(stripAnsi(out)).toMatchSnapshot()
    })

    it("matches the non-TTY (CI) rendering snapshot", () => {
      const out = renderPreflight(visualReport, { isTTY: false, yes: false })
      expect(stripAnsi(out)).toMatchSnapshot()
    })
  })

  describe("runPreflight TTY gate", () => {
    it("auto-proceeds without waiting on stdin in non-TTY mode", async () => {
      const { stream, chunks } = captureWritable()
      const input = new PassThrough()
      const before = Date.now()
      await runPreflight(visualReport, { isTTY: false, yes: false, stream, input })
      const elapsed = Date.now() - before
      expect(elapsed).toBeLessThan(200)
      expect(chunks.join("")).toContain("(auto-proceeding in CI)")
    })

    it("auto-proceeds without waiting when --yes is set in TTY mode", async () => {
      const { stream } = captureWritable()
      const input = new PassThrough()
      const before = Date.now()
      await runPreflight(visualReport, { isTTY: true, yes: true, stream, input })
      const elapsed = Date.now() - before
      expect(elapsed).toBeLessThan(200)
    })

    it("waits for a newline on stdin when interactive (no --yes)", async () => {
      const { stream } = captureWritable()
      const input = new PassThrough()
      let resolved = false
      const promise = runPreflight(visualReport, { isTTY: true, yes: false, stream, input })
        .then(() => { resolved = true })

      await new Promise((r) => setTimeout(r, 200))
      expect(resolved).toBe(false)

      input.write("\n")
      await promise
      expect(resolved).toBe(true)
    })

    it("writes the rendered output to the configured stream", async () => {
      const { stream, chunks } = captureWritable()
      const input = new PassThrough()
      await runPreflight(visualReport, { isTTY: false, yes: false, stream, input })
      const written = chunks.join("")
      expect(stripAnsi(written)).toContain("Detected")
      expect(stripAnsi(written)).toContain("enabling")
    })
  })

  describe("source hygiene", () => {
    it("does not import any raw ANSI literals (control sequences route through color helper)", async () => {
      const fs = await import("node:fs")
      const path = await import("node:path")
      const src = fs.readFileSync(path.resolve(__dirname, "../preflight.ts"), "utf-8")
      const escapeChar = String.fromCharCode(27)
      expect(src.includes(escapeChar)).toBe(false)
      expect(src.includes("\\x1b")).toBe(false)
    })
  })
})

// vi is referenced indirectly to satisfy import-style checks in some lint setups
void vi
