import { describe, it, expect, vi, beforeEach } from "vitest"
import { writeFileSync } from "node:fs"
import { homedir } from "node:os"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return { ...actual, writeFileSync: vi.fn() }
})

import {
  buildSandboxPolicy,
  greywallProvider,
} from "../claude/sandbox.policy.js"

const EMPTY_EXTRAS = { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] }

const PRE_MIGRATION_ALLOWLIST = [
  "api.anthropic.com",
  "downloads.claude.ai",
  "http-intake.logs.us5.datadoghq.com",
  "registry.npmjs.org",
  "nodejs.org",
  "objects.githubusercontent.com",
  "raw.githubusercontent.com",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "static.crates.io",
  "rubygems.org",
  "proxy.golang.org",
  "github.com",
  "gitlab.com",
  "bitbucket.org",
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe("sandbox parity: buildSandboxPolicy vs legacy greywallProvider.buildArgs", () => {
  describe("network parity (one network-blocked scenario)", () => {
    it("blocks a host outside the allowlist: 'evil.example.com' is absent from both legacy and policy network_allowlist", () => {
      const policy = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/repo/.ridgeline/builds/x" })
      expect(policy!.network_allowlist).not.toContain("evil.example.com")
      expect(PRE_MIGRATION_ALLOWLIST).not.toContain("evil.example.com")
    })

    it("admits an allowlisted host: 'api.anthropic.com' appears in both legacy and policy network_allowlist", () => {
      const policy = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/repo/.ridgeline/builds/x" })
      expect(policy!.network_allowlist).toContain("api.anthropic.com")
      expect(PRE_MIGRATION_ALLOWLIST).toContain("api.anthropic.com")
    })

    it("policy network_allowlist is a subset of (or equal to) the pre-migration host set — no widening", () => {
      const policy = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/repo/.ridgeline/builds/x" })
      const hostSet = new Set(PRE_MIGRATION_ALLOWLIST)
      for (const host of policy!.network_allowlist!) {
        expect(hostSet.has(host)).toBe(true)
      }
    })
  })

  describe("filesystem parity (one filesystem-blocked scenario)", () => {
    it("blocks /etc/passwd: absent from both legacy allowWrite and policy additional_write_paths", () => {
      const policy = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/repo/.ridgeline/builds/x" })
      expect(policy!.additional_write_paths).not.toContain("/etc/passwd")

      greywallProvider.buildArgs("/repo", [], { mode: "semi-locked", extras: EMPTY_EXTRAS })
      const calls = vi.mocked(writeFileSync).mock.calls
      const settingsPayload = calls[calls.length - 1]?.[1] as string
      const legacy = JSON.parse(settingsPayload)
      expect(legacy.filesystem.allowWrite).not.toContain("/etc/passwd")
    })

    it("admits buildPath as writable: present in policy additional_write_paths and matches the documented placement", () => {
      const policy = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/repo/.ridgeline/builds/parity-build" })
      expect(policy!.additional_write_paths).toContain("/repo/.ridgeline/builds/parity-build")
      expect(policy!.additional_write_paths![0]).toBe("/repo/.ridgeline/builds/parity-build")
    })

    it("policy and legacy both expose /tmp as writable", () => {
      const policy = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/repo/.ridgeline/builds/x" })
      expect(policy!.additional_write_paths).toContain("/tmp")

      greywallProvider.buildArgs("/repo", [], { mode: "semi-locked", extras: EMPTY_EXTRAS })
      const calls = vi.mocked(writeFileSync).mock.calls
      const settingsPayload = calls[calls.length - 1]?.[1] as string
      const legacy = JSON.parse(settingsPayload)
      expect(legacy.filesystem.allowWrite).toContain("/tmp")
    })

    it("semi-locked mode shares the agent-browser cache hole between policy and legacy", () => {
      const home = homedir()
      const policy = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/repo/.ridgeline/builds/x" })
      expect(policy!.additional_write_paths).toContain(`${home}/.agent-browser`)

      greywallProvider.buildArgs("/repo", [], { mode: "semi-locked", extras: EMPTY_EXTRAS })
      const calls = vi.mocked(writeFileSync).mock.calls
      const settingsPayload = calls[calls.length - 1]?.[1] as string
      const legacy = JSON.parse(settingsPayload)
      expect(legacy.filesystem.allowWrite).toContain(`${home}/.agent-browser`)
    })

    it("policy uses the new buildPath placement; legacy uses repoRoot — both are per-invocation parameters", () => {
      const policyA = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/repo/.ridgeline/builds/A" })
      const policyB = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/repo/.ridgeline/builds/B" })
      expect(policyA!.additional_write_paths![0]).not.toBe(policyB!.additional_write_paths![0])

      greywallProvider.buildArgs("/repoA", [], { mode: "semi-locked", extras: EMPTY_EXTRAS })
      greywallProvider.buildArgs("/repoB", [], { mode: "semi-locked", extras: EMPTY_EXTRAS })
      const calls = vi.mocked(writeFileSync).mock.calls
      const legacyA = JSON.parse(calls[calls.length - 2][1] as string)
      const legacyB = JSON.parse(calls[calls.length - 1][1] as string)
      expect(legacyA.filesystem.allowWrite[0]).toBe("/repoA")
      expect(legacyB.filesystem.allowWrite[0]).toBe("/repoB")
    })
  })
})

