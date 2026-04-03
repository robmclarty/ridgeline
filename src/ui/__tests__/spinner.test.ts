import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { formatElapsed, pickVerb, startSpinner } from "../spinner"

describe("spinner", () => {
  describe("formatElapsed", () => {
    it("formats zero milliseconds", () => {
      expect(formatElapsed(0)).toBe("0s")
    })

    it("formats seconds only", () => {
      expect(formatElapsed(5000)).toBe("5s")
    })

    it("formats minutes and seconds with padding", () => {
      expect(formatElapsed(65000)).toBe("1m 05s")
    })

    it("formats exact minutes", () => {
      expect(formatElapsed(120000)).toBe("2m 00s")
    })

    it("floors partial seconds", () => {
      expect(formatElapsed(1999)).toBe("1s")
    })
  })

  describe("pickVerb", () => {
    it("returns a non-empty string", () => {
      const verb = pickVerb()
      expect(typeof verb).toBe("string")
      expect(verb.length).toBeGreaterThan(0)
    })
  })

  describe("startSpinner", () => {
    let originalIsTTY: boolean | undefined

    beforeEach(() => {
      originalIsTTY = process.stderr.isTTY
    })

    afterEach(() => {
      Object.defineProperty(process.stderr, "isTTY", { value: originalIsTTY, writable: true })
    })

    it("returns no-op spinner when stderr is not a TTY", () => {
      Object.defineProperty(process.stderr, "isTTY", { value: false, writable: true })
      const spinner = startSpinner("Testing")
      // Should not throw
      spinner.stop()
      spinner.pause()
      spinner.resume()
    })

    it("returns spinner with stop/pause/resume methods", () => {
      Object.defineProperty(process.stderr, "isTTY", { value: true, writable: true })
      const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
      const spinner = startSpinner("Testing")

      expect(typeof spinner.stop).toBe("function")
      expect(typeof spinner.pause).toBe("function")
      expect(typeof spinner.resume).toBe("function")

      spinner.stop()
      writeSpy.mockRestore()
    })

    it("writes frames to stderr", () => {
      vi.useFakeTimers()
      Object.defineProperty(process.stderr, "isTTY", { value: true, writable: true })
      const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

      const spinner = startSpinner("Testing")
      vi.advanceTimersByTime(120)

      expect(writeSpy).toHaveBeenCalled()
      const output = writeSpy.mock.calls[0][0] as string
      expect(output).toContain("[")
      expect(output).toContain("Testing...")

      spinner.stop()
      writeSpy.mockRestore()
      vi.useRealTimers()
    })

    it("stop is idempotent", () => {
      Object.defineProperty(process.stderr, "isTTY", { value: true, writable: true })
      const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
      const spinner = startSpinner("Testing")

      spinner.stop()
      spinner.stop() // should not throw

      writeSpy.mockRestore()
    })

    it("pause stops writing and resume restarts", () => {
      vi.useFakeTimers()
      Object.defineProperty(process.stderr, "isTTY", { value: true, writable: true })
      const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

      const spinner = startSpinner("Testing")
      vi.advanceTimersByTime(120)

      spinner.pause()
      writeSpy.mockClear()
      vi.advanceTimersByTime(360)
      expect(writeSpy.mock.calls.length).toBe(0) // no writes while paused

      spinner.resume()
      vi.advanceTimersByTime(120)
      expect(writeSpy.mock.calls.length).toBeGreaterThan(0)

      spinner.stop()
      writeSpy.mockRestore()
      vi.useRealTimers()
    })

    it("uses custom verb when provided", () => {
      vi.useFakeTimers()
      Object.defineProperty(process.stderr, "isTTY", { value: true, writable: true })
      const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

      const spinner = startSpinner("Bamboozling")
      vi.advanceTimersByTime(120)

      const allOutput = writeSpy.mock.calls.map((c) => c[0] as string).join("")
      expect(allOutput).toContain("Bamboozling...")

      spinner.stop()
      writeSpy.mockRestore()
      vi.useRealTimers()
    })

    it("picks a random verb when none provided", () => {
      vi.useFakeTimers()
      Object.defineProperty(process.stderr, "isTTY", { value: true, writable: true })
      const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

      const spinner = startSpinner()
      vi.advanceTimersByTime(120)

      const output = writeSpy.mock.calls[0][0] as string
      expect(output).toContain("...")

      spinner.stop()
      writeSpy.mockRestore()
      vi.useRealTimers()
    })
  })
})
