import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import * as fs from "node:fs"
import * as cp from "node:child_process"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return { ...actual, writeFileSync: vi.fn() }
})

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process")
  return { ...actual, execFileSync: vi.fn() }
})

import { greywallProvider } from "../sandbox.policy.js"

const EMPTY_EXTRAS = { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] }

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  globalThis.fetch = mockFetch
})

afterEach(() => vi.restoreAllMocks())

describe("greywallProvider", () => {
  it("has name 'greywall' and command 'greywall'", () => {
    expect(greywallProvider.name).toBe("greywall")
    expect(greywallProvider.command).toBe("greywall")
  })

  it("strict mode writes allowWrite for repo, /tmp, additional paths, and extras", () => {
    greywallProvider.buildArgs("/my/repo", [], {
      mode: "strict",
      extras: EMPTY_EXTRAS,
      additionalWritePaths: ["/extra/scratch"],
    })

    expect(fs.writeFileSync).toHaveBeenCalledOnce()
    const [path, content] = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(path).toMatch(/ridgeline-greywall-/)
    const settings = JSON.parse(content as string)
    expect(settings.filesystem.allowWrite).toEqual(["/my/repo", "/tmp", "/extra/scratch"])
  })

  it("strict mode passes --profile claude,node, --no-credential-protection, --settings, and -- separator", () => {
    const args = greywallProvider.buildArgs("/repo", [], { mode: "strict", extras: EMPTY_EXTRAS })
    expect(args[0]).toBe("--profile")
    expect(args[1]).toBe("claude,node")
    expect(args[2]).toBe("--no-credential-protection")
    expect(args).toContain("--settings")
    expect(args[args.length - 1]).toBe("--")
  })

  it("semi-locked mode (default) widens profile composition and write paths", () => {
    const args = greywallProvider.buildArgs("/repo", [], { mode: "semi-locked", extras: EMPTY_EXTRAS })
    const profiles = args[1].split(",")
    expect(profiles).toContain("claude")
    expect(profiles).toContain("node")
    expect(profiles).toContain("python")
    expect(profiles).toContain("docker")

    const calls = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls
    const [, content] = calls[calls.length - 1]
    const settings = JSON.parse(content as string)
    expect(settings.filesystem.allowWrite.some((p: string) => p.endsWith("/.agent-browser"))).toBe(true)
    expect(settings.filesystem.allowWrite.some((p: string) => p.endsWith("/.cache/uv"))).toBe(true)
  })

  it("merges extraProfiles, extraWritePaths, and extraReadPaths into the spawn args", () => {
    const args = greywallProvider.buildArgs("/repo", [], {
      mode: "semi-locked",
      extras: {
        writePaths: ["/custom/write"],
        readPaths: ["/custom/read"],
        profiles: ["custom-profile"],
        networkAllowlist: [],
      },
    })
    expect(args[1]).toContain("custom-profile")

    const calls = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls
    const [, content] = calls[calls.length - 1]
    const settings = JSON.parse(content as string)
    expect(settings.filesystem.allowWrite).toContain("/custom/write")
    expect(settings.filesystem.allowRead).toContain("/custom/read")
  })

  it("does not include network key in settings file (rules managed via greyproxy API)", () => {
    greywallProvider.buildArgs("/repo", ["api.anthropic.com", "registry.npmjs.org"], {
      mode: "strict",
      extras: EMPTY_EXTRAS,
    })

    const calls = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls
    const [, content] = calls[calls.length - 1]
    const settings = JSON.parse(content as string)
    expect(settings.network).toBeUndefined()
  })

  describe("checkReady", () => {
    it("returns null when greyproxy is running", () => {
      vi.mocked(cp.execFileSync).mockReturnValue("✓ greyproxy running\n")

      expect(greywallProvider.checkReady!()).toBeNull()
    })

    it("returns error message when greyproxy is not running", () => {
      vi.mocked(cp.execFileSync).mockReturnValue("greyproxy stopped\n")

      expect(greywallProvider.checkReady!()).toContain("greyproxy is not running")
    })

    it("returns null when execFileSync throws but output matches", () => {
      const err = new Error("exit code 1")
      ;(err as any).stdout = "✓ greyproxy running"
      ;(err as any).stderr = ""
      vi.mocked(cp.execFileSync).mockImplementation(() => { throw err })

      expect(greywallProvider.checkReady!()).toBeNull()
    })

    it("returns error message when execFileSync throws and output does not match", () => {
      const err = new Error("command not found")
      ;(err as any).stdout = ""
      ;(err as any).stderr = "greywall: not found"
      vi.mocked(cp.execFileSync).mockImplementation(() => { throw err })

      expect(greywallProvider.checkReady!()).toContain("greyproxy is not running")
    })
  })

  describe("syncRules", () => {
    it("creates rules for domains not already in greyproxy", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [{ destination_pattern: "api.anthropic.com" }] }),
        })
        .mockResolvedValue({ ok: true, json: async () => ({}) })

      await greywallProvider.syncRules!(["api.anthropic.com", "registry.npmjs.org"])

      // First call fetches existing rules, second creates the missing one
      expect(mockFetch).toHaveBeenCalledTimes(2)
      const createCall = mockFetch.mock.calls[1]
      expect(createCall[0]).toContain("/api/rules")
      const body = JSON.parse(createCall[1].body)
      expect(body.destination_pattern).toBe("registry.npmjs.org")
      expect(body.container_pattern).toBe("claude*")
    })

    it("skips creation when all rules already exist", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { destination_pattern: "api.anthropic.com" },
            { destination_pattern: "registry.npmjs.org" },
          ],
        }),
      })

      await greywallProvider.syncRules!(["api.anthropic.com", "registry.npmjs.org"])

      // Only the initial fetch, no POSTs
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it("does nothing when allowlist is empty", async () => {
      await greywallProvider.syncRules!([])
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})
