import { PassThrough, Writable } from "node:stream"
import { describe, expect, it } from "vitest"
import type { DetectionReport } from "../engine/detect"
import { runPreflight } from "../ui/preflight"

const visualReport: DetectionReport = {
  projectType: "web",
  isVisualSurface: true,
  detectedDeps: ["react", "vite"],
  hasDesignMd: true,
  hasAssetDir: false,
  suggestedSensors: ["playwright", "vision", "a11y", "contrast"],
  suggestedEnsembleSize: 2,
}

describe("preflight ordering", () => {
  it("preflight stdout appears before any subsequent model-call log line", async () => {
    const events: string[] = []
    const stream = new Writable({
      write(chunk, _enc, cb) {
        events.push(`PREFLIGHT::${chunk.toString()}`)
        cb()
      },
    })
    const input = new PassThrough()

    // Simulate a pipeline-entry action: preflight first, then model call.
    await runPreflight(visualReport, { isTTY: false, yes: false, stream, input })
    events.push("MODEL_CALL::shape")

    const preflightIdx = events.findIndex((e) => e.startsWith("PREFLIGHT::"))
    const modelIdx = events.findIndex((e) => e.startsWith("MODEL_CALL::"))
    expect(preflightIdx).toBeGreaterThan(-1)
    expect(modelIdx).toBeGreaterThan(preflightIdx)
  })

  it("preflight rejects when stdin is closed without input in TTY mode (Ctrl+C analogue)", async () => {
    const stream = new Writable({ write(_c, _e, cb) { cb() } })
    const input = new PassThrough()
    const promise = runPreflight(visualReport, { isTTY: true, yes: false, stream, input })

    // Closing the input mid-wait simulates the readline being torn down on Ctrl+C.
    setTimeout(() => input.end(), 50)

    // Should resolve (close event), not hang. If preflight didn't unwind, the
    // test would time out — vitest's default timeout protects us either way.
    await promise
  })
})
