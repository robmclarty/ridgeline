import { describe, it, expect, vi, afterEach } from "vitest"
import { greywallProvider } from "../sandbox.greywall"
import * as fs from "node:fs"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return { ...actual, writeFileSync: vi.fn() }
})

afterEach(() => vi.restoreAllMocks())

describe("greywallProvider", () => {
  it("has name 'greywall' and command 'greywall'", () => {
    expect(greywallProvider.name).toBe("greywall")
    expect(greywallProvider.command).toBe("greywall")
  })

  it("writes a settings file with allowWrite for repo and /tmp", () => {
    greywallProvider.buildArgs("/my/repo", [])

    expect(fs.writeFileSync).toHaveBeenCalledOnce()
    const [path, content] = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(path).toMatch(/ridgeline-greywall-/)
    const settings = JSON.parse(content as string)
    expect(settings.filesystem.allowWrite).toContain("/my/repo")
    expect(settings.filesystem.allowWrite).toContain("/tmp")
  })

  it("passes --auto-profile, --no-credential-protection, --settings, and -- separator", () => {
    const args = greywallProvider.buildArgs("/repo", [])
    expect(args[0]).toBe("--auto-profile")
    expect(args[1]).toBe("--no-credential-protection")
    expect(args).toContain("--settings")
    expect(args[args.length - 1]).toBe("--")
  })

  it("includes network allowlist in settings when provided", () => {
    greywallProvider.buildArgs("/repo", ["api.anthropic.com", "registry.npmjs.org"])

    const calls = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls
    const [, content] = calls[calls.length - 1]
    const settings = JSON.parse(content as string)
    expect(settings.network.allowlist).toEqual(["api.anthropic.com", "registry.npmjs.org"])
  })

  it("omits network key when allowlist is empty", () => {
    greywallProvider.buildArgs("/repo", [])

    const calls = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls
    const [, content] = calls[calls.length - 1]
    const settings = JSON.parse(content as string)
    expect(settings.network).toBeUndefined()
  })
})
