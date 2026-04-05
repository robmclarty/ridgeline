import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  }
})

import { resolveAgentPrompt } from "../agent.prompt"
import * as fs from "node:fs"

beforeEach(() => vi.clearAllMocks())

describe("resolveAgentPrompt", () => {
  it("returns content from first candidate path when it exists", () => {
    vi.mocked(fs.existsSync).mockReturnValueOnce(true)
    vi.mocked(fs.readFileSync).mockReturnValue("builder prompt content")

    const result = resolveAgentPrompt("builder.md")

    expect(result).toBe("builder prompt content")
    // Should only check first path
    expect(fs.existsSync).toHaveBeenCalledTimes(1)
  })

  it("falls through to second path when first does not exist", () => {
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(false) // distPath
      .mockReturnValueOnce(true) // srcPath
    vi.mocked(fs.readFileSync).mockReturnValue("from src path")

    const result = resolveAgentPrompt("builder.md")

    expect(result).toBe("from src path")
    expect(fs.existsSync).toHaveBeenCalledTimes(2)
  })

  it("falls through to third path when first two do not exist", () => {
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(false) // distPath
      .mockReturnValueOnce(false) // srcPath
    vi.mocked(fs.readFileSync).mockReturnValue("from root path")

    const result = resolveAgentPrompt("builder.md")

    expect(result).toBe("from root path")
    // readFileSync called for the rootPath (no existsSync check, just reads directly)
    expect(fs.readFileSync).toHaveBeenCalledTimes(1)
  })

  it("throws when file is not found at any path", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory")
    })

    expect(() => resolveAgentPrompt("nonexistent.md")).toThrow("ENOENT")
  })
})
