import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import { loadSettings, resolveNetworkAllowlist, DEFAULT_NETWORK_ALLOWLIST } from "../settings"

describe("settings", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe("loadSettings", () => {
    it("returns empty object when settings.json does not exist", () => {
      const settings = loadSettings(tmpDir)
      expect(settings).toEqual({})
    })

    it("loads and parses settings.json", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ network: { allowlist: ["example.com"] } })
      )
      const settings = loadSettings(tmpDir)
      expect(settings.network?.allowlist).toEqual(["example.com"])
    })

    it("returns empty object on invalid JSON", () => {
      fs.writeFileSync(path.join(tmpDir, "settings.json"), "not json")
      const settings = loadSettings(tmpDir)
      expect(settings).toEqual({})
    })
  })

  describe("resolveNetworkAllowlist", () => {
    it("returns defaults when no settings file exists", () => {
      const allowlist = resolveNetworkAllowlist(tmpDir)
      expect(allowlist).toEqual(DEFAULT_NETWORK_ALLOWLIST)
    })

    it("replaces defaults when user specifies allowlist", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ network: { allowlist: ["custom.registry.com"] } })
      )
      const allowlist = resolveNetworkAllowlist(tmpDir)
      expect(allowlist).toEqual(["custom.registry.com"])
    })

    it("returns defaults when network key is present but allowlist is omitted", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ network: {} })
      )
      const allowlist = resolveNetworkAllowlist(tmpDir)
      expect(allowlist).toEqual(DEFAULT_NETWORK_ALLOWLIST)
    })
  })

  describe("DEFAULT_NETWORK_ALLOWLIST", () => {
    it("contains common package registries", () => {
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("registry.npmjs.org")
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("pypi.org")
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("crates.io")
    })

    it("contains common git hosts", () => {
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("github.com")
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("gitlab.com")
    })
  })
})
