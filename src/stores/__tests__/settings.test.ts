import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import { loadSettings, resolveNetworkAllowlist, DEFAULT_NETWORK_ALLOWLIST, CLAUDE_REQUIRED_DOMAINS } from "../settings"

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

    it("merges Claude domains with user-specified allowlist", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ network: { allowlist: ["custom.registry.com"] } })
      )
      const allowlist = resolveNetworkAllowlist(tmpDir)
      for (const domain of CLAUDE_REQUIRED_DOMAINS) {
        expect(allowlist).toContain(domain)
      }
      expect(allowlist).toContain("custom.registry.com")
    })

    it("returns empty array when allowlist contains wildcard", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ network: { allowlist: ["*"] } })
      )
      const allowlist = resolveNetworkAllowlist(tmpDir)
      expect(allowlist).toEqual([])
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
    it("contains Claude required domains", () => {
      for (const domain of CLAUDE_REQUIRED_DOMAINS) {
        expect(DEFAULT_NETWORK_ALLOWLIST).toContain(domain)
      }
    })

    it("contains common package registries", () => {
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("registry.npmjs.org")
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("nodejs.org")
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("pypi.org")
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("crates.io")
    })

    it("contains GitHub asset domains for binary downloads", () => {
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("objects.githubusercontent.com")
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("raw.githubusercontent.com")
    })

    it("contains common git hosts", () => {
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("github.com")
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("gitlab.com")
    })
  })
})
