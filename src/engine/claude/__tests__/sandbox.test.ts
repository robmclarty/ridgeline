import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}))

// Mock the provider modules so detectSandbox can require them
vi.mock("../sandbox.bwrap", () => ({
  bwrapProvider: { name: "bwrap", command: "bwrap", buildArgs: vi.fn(() => []) },
}))

vi.mock("../sandbox.greywall", () => ({
  greywallProvider: { name: "greywall", command: "greywall", buildArgs: vi.fn(() => []), checkReady: vi.fn(() => null) },
}))

import { execFileSync } from "node:child_process"
import { detectSandbox } from "../sandbox"
import { greywallProvider } from "../sandbox.greywall"

const withPlatform = (platform: string, fn: () => void) => {
  const orig = Object.getOwnPropertyDescriptor(process, "platform")
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
  try {
    fn()
  } finally {
    if (orig) Object.defineProperty(process, "platform", orig)
  }
}

describe("detectSandbox", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("returns greywall provider when greywall is available and ready", () => {
    vi.mocked(execFileSync).mockReturnValue("/usr/local/bin/greywall")

    const { provider, warning } = detectSandbox()
    expect(provider).not.toBeNull()
    expect(provider!.name).toBe("greywall")
    expect(warning).toBeNull()
  })

  it("returns null provider with warning when greyproxy is not running", () => {
    vi.mocked(execFileSync).mockReturnValue("/usr/local/bin/greywall")
    vi.mocked(greywallProvider.checkReady!).mockReturnValue("greyproxy is not running. Start it with: greywall setup")

    const { provider, warning } = detectSandbox()
    expect(provider).toBeNull()
    expect(warning).toContain("greyproxy is not running")
    expect(warning).toContain("Running without sandbox")
  })

  it("returns bwrap provider on linux when greywall is absent", () => {
    vi.mocked(execFileSync).mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args.includes("greywall")) throw new Error("not found")
      return "/usr/bin/bwrap"
    })

    withPlatform("linux", () => {
      const { provider } = detectSandbox()
      expect(provider).not.toBeNull()
      expect(provider!.name).toBe("bwrap")
    })
  })

  it("returns null on macOS when greywall is absent", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not found")
    })

    withPlatform("darwin", () => {
      const { provider } = detectSandbox()
      expect(provider).toBeNull()
    })
  })

  it("returns null when neither tool is available", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not found")
    })

    const { provider } = detectSandbox()
    expect(provider).toBeNull()
  })
})
