import { describe, it, expect, vi } from "vitest"
import { logInfo, logError, logPhase } from "../logging"

describe("logging", () => {
  describe("logInfo", () => {
    it("logs with [ridgeline] prefix", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {})
      logInfo("hello")
      expect(spy).toHaveBeenCalledWith("[ridgeline] hello")
      spy.mockRestore()
    })
  })

  describe("logError", () => {
    it("logs with [ridgeline] ERROR: prefix to stderr", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {})
      logError("something broke")
      expect(spy).toHaveBeenCalledWith("[ridgeline] ERROR: something broke")
      spy.mockRestore()
    })
  })

  describe("logPhase", () => {
    it("logs with phase id in brackets", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {})
      logPhase("01-scaffold", "Building...")
      expect(spy).toHaveBeenCalledWith("[ridgeline] [01-scaffold] Building...")
      spy.mockRestore()
    })
  })
})
