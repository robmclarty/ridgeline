import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../sandbox.policy", async () => {
  const actual = await vi.importActual<typeof import("../sandbox.policy")>("../sandbox.policy")
  return {
    ...actual,
    isAvailable: vi.fn(),
    greywallProvider: { name: "greywall", command: "greywall", buildArgs: vi.fn(() => []), checkReady: vi.fn(() => null) },
  }
})

import { detectSandbox } from "../sandbox"
import { greywallProvider, isAvailable } from "../sandbox.policy"

describe("detectSandbox", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("returns greywall provider when greywall is available and ready", () => {
    vi.mocked(isAvailable).mockReturnValue(true)
    vi.mocked(greywallProvider.checkReady!).mockReturnValue(null)

    const { provider, warning } = detectSandbox()
    expect(provider).not.toBeNull()
    expect(provider!.name).toBe("greywall")
    expect(warning).toBeNull()
  })

  it("returns null provider with warning when greyproxy is not running", () => {
    vi.mocked(isAvailable).mockReturnValue(true)
    vi.mocked(greywallProvider.checkReady!).mockReturnValue("greyproxy is not running. Start it with: greywall setup")

    const { provider, warning } = detectSandbox()
    expect(provider).toBeNull()
    expect(warning).toContain("greyproxy is not running")
    expect(warning).toContain("Running without sandbox")
  })

  it("returns null when greywall is absent", () => {
    vi.mocked(isAvailable).mockReturnValue(false)

    const { provider } = detectSandbox()
    expect(provider).toBeNull()
  })

  it("returns null with no warning when mode is 'off'", () => {
    const { provider, warning } = detectSandbox("off")
    expect(provider).toBeNull()
    expect(warning).toBeNull()
    // No tool probes should run when sandbox is explicitly off
    expect(isAvailable).not.toHaveBeenCalled()
  })
})
