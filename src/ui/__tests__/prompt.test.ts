import { describe, it, expect, vi, beforeEach } from "vitest"

const mockQuestion = vi.fn()
const mockClose = vi.fn()

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: mockQuestion,
    close: mockClose,
  }),
}))

import { askBuildName } from "../prompt"

describe("prompt", () => {
  beforeEach(() => {
    mockQuestion.mockReset()
    mockClose.mockReset()
  })

  describe("askBuildName", () => {
    it("returns the trimmed user input", async () => {
      mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
        cb("  my-build  ")
      })

      const name = await askBuildName()
      expect(name).toBe("my-build")
    })

    it("prompts with 'Build name: '", async () => {
      mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
        cb("test")
      })

      await askBuildName()
      expect(mockQuestion).toHaveBeenCalledWith("Build name: ", expect.any(Function))
    })

    it("closes the readline interface after input", async () => {
      mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
        cb("test")
      })

      await askBuildName()
      expect(mockClose).toHaveBeenCalled()
    })

    it("returns empty string when user enters nothing", async () => {
      mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
        cb("   ")
      })

      const name = await askBuildName()
      expect(name).toBe("")
    })
  })
})
