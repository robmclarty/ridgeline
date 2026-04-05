import { describe, it, expect, vi, afterEach } from "vitest"
import * as fs from "node:fs"
import * as cp from "node:child_process"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return { ...actual, writeFileSync: vi.fn() }
})

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process")
  return { ...actual, execSync: vi.fn() }
})

import { greywallProvider } from "../sandbox.greywall"

afterEach(() => vi.restoreAllMocks())

describe("greywallProvider", () => {
  it("has name 'greywall' and command 'greywall'", () => {
    expect(greywallProvider.name).toBe("greywall")
    expect(greywallProvider.command).toBe("greywall")
  })

  it("writes a settings file with allowWrite for repo, /tmp, and package manager caches", () => {
    greywallProvider.buildArgs("/my/repo", [])

    expect(fs.writeFileSync).toHaveBeenCalledOnce()
    const [path, content] = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(path).toMatch(/ridgeline-greywall-/)
    const settings = JSON.parse(content as string)
    expect(settings.filesystem.allowWrite).toContain("/my/repo")
    expect(settings.filesystem.allowWrite).toContain("/tmp")
    // Package manager cache directories
    expect(settings.filesystem.allowWrite).toEqual(
      expect.arrayContaining([
        expect.stringContaining(".npm"),
        expect.stringContaining(".cache"),
        expect.stringContaining(".yarn"),
        expect.stringContaining(".cargo"),
      ])
    )
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

  describe("checkReady", () => {
    it("returns null when greyproxy is running", () => {
      vi.mocked(cp.execSync).mockReturnValue("✓ greyproxy running\n")

      expect(greywallProvider.checkReady()).toBeNull()
    })

    it("returns error message when greyproxy is not running", () => {
      vi.mocked(cp.execSync).mockReturnValue("greyproxy stopped\n")

      expect(greywallProvider.checkReady()).toContain("greyproxy is not running")
    })

    it("returns null when execSync throws but output matches", () => {
      const err = new Error("exit code 1")
      ;(err as any).stdout = "✓ greyproxy running"
      ;(err as any).stderr = ""
      vi.mocked(cp.execSync).mockImplementation(() => { throw err })

      expect(greywallProvider.checkReady()).toBeNull()
    })

    it("returns error message when execSync throws and output does not match", () => {
      const err = new Error("command not found")
      ;(err as any).stdout = ""
      ;(err as any).stderr = "greywall: not found"
      vi.mocked(cp.execSync).mockImplementation(() => { throw err })

      expect(greywallProvider.checkReady()).toContain("greyproxy is not running")
    })
  })
})
