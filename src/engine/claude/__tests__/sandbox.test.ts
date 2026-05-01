import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}))

vi.mock("../sandbox.greywall", () => ({
  greywallProvider: { name: "greywall", command: "greywall", buildArgs: vi.fn(() => []), checkReady: vi.fn(() => null) },
}))

import { execFileSync } from "node:child_process"
import { detectSandbox } from "../sandbox"
import { greywallProvider } from "../sandbox.greywall"

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

  it("returns null when greywall is absent", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not found")
    })

    const { provider } = detectSandbox()
    expect(provider).toBeNull()
  })

  it("returns null with no warning when mode is 'off'", () => {
    const { provider, warning } = detectSandbox("off")
    expect(provider).toBeNull()
    expect(warning).toBeNull()
    // No tool probes should run when sandbox is explicitly off
    expect(execFileSync).not.toHaveBeenCalled()
  })
})
