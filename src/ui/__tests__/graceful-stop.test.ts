import { EventEmitter } from "node:events"
import { Writable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { installGracefulStopListener } from "../graceful-stop"

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

/**
 * Build a fake input stream that satisfies the keypress-listener contract
 * without touching the real stdin or terminal raw mode.
 */
const makeFakeInput = (): EventEmitter & {
  setRawMode?: (raw: boolean) => void
  isRaw?: boolean
} => {
  const ee = new EventEmitter() as EventEmitter & {
    setRawMode?: (raw: boolean) => void
    isRaw?: boolean
  }
  ee.isRaw = false
  ee.setRawMode = (raw: boolean) => {
    ee.isRaw = raw
  }
  return ee
}

describe("installGracefulStopListener", () => {
  it("returns a no-op handle in non-TTY environments", () => {
    const { stream, chunks } = captureWritable()
    const input = makeFakeInput()
    const handle = installGracefulStopListener({ stream, input: input as unknown as NodeJS.ReadableStream, isTTY: false })
    expect(handle.isRequested()).toBe(false)

    input.emit("keypress", "q", { name: "q", ctrl: false })
    expect(handle.isRequested()).toBe(false)
    expect(chunks.join("")).toBe("")

    handle.uninstall() // must not throw
  })

  it("sets the requested flag on first 'q' keypress", () => {
    const { stream, chunks } = captureWritable()
    const input = makeFakeInput()
    const handle = installGracefulStopListener({ stream, input: input as unknown as NodeJS.ReadableStream, isTTY: true })

    input.emit("keypress", "q", { name: "q", ctrl: false })

    expect(handle.isRequested()).toBe(true)
    expect(chunks.join("")).toContain("Graceful stop requested")
    handle.uninstall()
  })

  it("treats Ctrl-G as the stop key too", () => {
    const { stream } = captureWritable()
    const input = makeFakeInput()
    const handle = installGracefulStopListener({ stream, input: input as unknown as NodeJS.ReadableStream, isTTY: true })

    input.emit("keypress", undefined, { name: "g", ctrl: true })

    expect(handle.isRequested()).toBe(true)
    handle.uninstall()
  })

  it("ignores unrelated keys", () => {
    const { stream, chunks } = captureWritable()
    const input = makeFakeInput()
    const handle = installGracefulStopListener({ stream, input: input as unknown as NodeJS.ReadableStream, isTTY: true })

    input.emit("keypress", "a", { name: "a", ctrl: false })
    input.emit("keypress", "Q", { name: "Q", ctrl: false })

    expect(handle.isRequested()).toBe(false)
    expect(chunks.join("")).toBe("")
    handle.uninstall()
  })

  it("escalates to onSecondPress on a second 'q' within 5 seconds", () => {
    const { stream, chunks } = captureWritable()
    const input = makeFakeInput()
    const onSecondPress = vi.fn()
    const handle = installGracefulStopListener({ stream, input: input as unknown as NodeJS.ReadableStream, isTTY: true, onSecondPress })

    input.emit("keypress", "q", { name: "q", ctrl: false })
    input.emit("keypress", "q", { name: "q", ctrl: false })

    expect(onSecondPress).toHaveBeenCalledTimes(1)
    expect(chunks.join("")).toContain("escalating to SIGINT")
    handle.uninstall()
  })

  it("uninstall removes the keypress listener so further presses are no-ops", () => {
    const { stream } = captureWritable()
    const input = makeFakeInput()
    const onSecondPress = vi.fn()
    const handle = installGracefulStopListener({ stream, input: input as unknown as NodeJS.ReadableStream, isTTY: true, onSecondPress })

    handle.uninstall()
    input.emit("keypress", "q", { name: "q", ctrl: false })
    input.emit("keypress", "q", { name: "q", ctrl: false })

    expect(handle.isRequested()).toBe(false)
    expect(onSecondPress).not.toHaveBeenCalled()
  })

  it("restores prior raw-mode state on uninstall", () => {
    const { stream } = captureWritable()
    const input = makeFakeInput()
    input.isRaw = false
    const handle = installGracefulStopListener({ stream, input: input as unknown as NodeJS.ReadableStream, isTTY: true })
    expect(input.isRaw).toBe(true)
    handle.uninstall()
    expect(input.isRaw).toBe(false)
  })

  it("enables raw mode on the input stream when installed", () => {
    const { stream } = captureWritable()
    const input = makeFakeInput()
    expect(input.isRaw).toBe(false)
    const handle = installGracefulStopListener({ stream, input: input as unknown as NodeJS.ReadableStream, isTTY: true })
    expect(input.isRaw).toBe(true)
    handle.uninstall()
  })
})
