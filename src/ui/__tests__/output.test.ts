import { describe, it, expect, vi } from "vitest"
import { printInfo, printError, printPhase } from "../output.js"

describe("output", () => {
  describe("printInfo", () => {
    it("prints with [ridgeline] prefix", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {})
      printInfo("hello")
      expect(spy).toHaveBeenCalledWith("[ridgeline] hello")
      spy.mockRestore()
    })
  })

  describe("printError", () => {
    it("prints with [ridgeline] ERROR: prefix to stderr", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {})
      printError("something broke")
      expect(spy).toHaveBeenCalledWith("[ridgeline] ERROR: something broke")
      spy.mockRestore()
    })
  })

  describe("printPhase", () => {
    it("prints with phase id in brackets", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {})
      printPhase("01-scaffold", "Building...")
      expect(spy).toHaveBeenCalledWith("[ridgeline] [01-scaffold] Building...")
      spy.mockRestore()
    })
  })
})
