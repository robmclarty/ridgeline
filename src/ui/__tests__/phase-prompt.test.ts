import { PassThrough, Writable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runPhaseApproval } from "../phase-prompt.js"
import { stripAnsi } from "../color.js"

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

describe("runPhaseApproval", () => {
  let originalNoColor: string | undefined

  beforeEach(() => {
    originalNoColor = process.env.NO_COLOR
    process.env.NO_COLOR = "1"
  })

  afterEach(() => {
    if (originalNoColor === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = originalNoColor
  })

  const baseCtx = {
    completedIndex: 1,
    totalPhases: 3,
    completedPhaseId: "01-scaffold",
    nextPhaseId: "02-api",
  }

  it("returns 'continue' when the user presses Enter", async () => {
    const { stream } = captureWritable()
    const input = new PassThrough()
    setTimeout(() => input.write("\n"), 0)
    const decision = await runPhaseApproval({ ...baseCtx, isTTY: true, stream, input })
    expect(decision).toBe("continue")
  })

  it("returns 'continue' for explicit Y", async () => {
    const { stream } = captureWritable()
    const input = new PassThrough()
    setTimeout(() => input.write("Y\n"), 0)
    const decision = await runPhaseApproval({ ...baseCtx, isTTY: true, stream, input })
    expect(decision).toBe("continue")
  })

  it("returns 'stop' for n", async () => {
    const { stream } = captureWritable()
    const input = new PassThrough()
    setTimeout(() => input.write("n\n"), 0)
    const decision = await runPhaseApproval({ ...baseCtx, isTTY: true, stream, input })
    expect(decision).toBe("stop")
  })

  it("returns 'stop' for q (graceful-stop alias)", async () => {
    const { stream } = captureWritable()
    const input = new PassThrough()
    setTimeout(() => input.write("q\n"), 0)
    const decision = await runPhaseApproval({ ...baseCtx, isTTY: true, stream, input })
    expect(decision).toBe("stop")
  })

  it("auto-continues in non-TTY mode without reading input", async () => {
    const { stream, chunks } = captureWritable()
    const input = new PassThrough()
    const before = Date.now()
    const decision = await runPhaseApproval({ ...baseCtx, isTTY: false, stream, input })
    const elapsed = Date.now() - before
    expect(decision).toBe("continue")
    expect(elapsed).toBeLessThan(200)
    expect(chunks.join("")).toContain("(non-TTY: auto-continue)")
  })

  it("respects nonTTYDecision='stop' for non-TTY environments", async () => {
    const { stream, chunks } = captureWritable()
    const input = new PassThrough()
    const decision = await runPhaseApproval({
      ...baseCtx,
      isTTY: false,
      stream,
      input,
      nonTTYDecision: "stop",
    })
    expect(decision).toBe("stop")
    const output = chunks.join("")
    expect(output).toContain("non-TTY")
    expect(output).toContain("pausing build")
    expect(output).toContain("--require-phase-approval")
  })

  it("renders the completed and next phase ids in the prompt", async () => {
    const { stream, chunks } = captureWritable()
    const input = new PassThrough()
    setTimeout(() => input.write("\n"), 0)
    await runPhaseApproval({ ...baseCtx, isTTY: true, stream, input })
    const text = stripAnsi(chunks.join(""))
    expect(text).toContain("01-scaffold")
    expect(text).toContain("02-api")
    expect(text).toContain("[Y/n/q]")
  })

  it("says 'no further phases' when this was the final phase", async () => {
    const { stream, chunks } = captureWritable()
    const input = new PassThrough()
    setTimeout(() => input.write("\n"), 0)
    await runPhaseApproval({
      ...baseCtx,
      completedIndex: 3,
      nextPhaseId: "end",
      isTTY: true,
      stream,
      input,
    })
    const text = stripAnsi(chunks.join(""))
    expect(text).toContain("no further phases")
  })
})
