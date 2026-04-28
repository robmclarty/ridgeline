import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import {
  loadSettings,
  resolveNetworkAllowlist,
  resolveModel,
  resolveSpecialistTimeoutSeconds,
  resolvePhaseBudgetLimit,
  resolvePhaseTokenLimit,
  resolveSpecialistCount,
  resolveDirectionCount,
  resolveSandboxMode,
  resolveSandboxExtras,
  DEFAULT_NETWORK_ALLOWLIST,
  DEFAULT_SPECIALIST_TIMEOUT_SECONDS,
  DEFAULT_PHASE_BUDGET_LIMIT_USD,
  DEFAULT_PHASE_TOKEN_LIMIT,
  DEFAULT_SPECIALIST_COUNT,
  DEFAULT_DIRECTION_COUNT,
  DEFAULT_SANDBOX_MODE,
  CLAUDE_REQUIRED_DOMAINS,
} from "../settings"

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

  describe("resolveModel", () => {
    it("prefers the CLI opt when provided", () => {
      fs.writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify({ model: "claude-opus-4-7" }))
      expect(resolveModel("sonnet", tmpDir)).toBe("sonnet")
    })

    it("falls back to settings.json model when CLI opt is undefined", () => {
      fs.writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify({ model: "claude-opus-4-7" }))
      expect(resolveModel(undefined, tmpDir)).toBe("claude-opus-4-7")
    })

    it("falls back to 'opus' when neither is set", () => {
      expect(resolveModel(undefined, tmpDir)).toBe("opus")
    })
  })

  describe("resolveSpecialistTimeoutSeconds", () => {
    it("returns the default when no settings file exists", () => {
      expect(resolveSpecialistTimeoutSeconds(tmpDir)).toBe(DEFAULT_SPECIALIST_TIMEOUT_SECONDS)
    })

    it("reads specialistTimeoutSeconds from settings.json", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ specialistTimeoutSeconds: 600 })
      )
      expect(resolveSpecialistTimeoutSeconds(tmpDir)).toBe(600)
    })

    it("falls back to default for non-positive values", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ specialistTimeoutSeconds: 0 })
      )
      expect(resolveSpecialistTimeoutSeconds(tmpDir)).toBe(DEFAULT_SPECIALIST_TIMEOUT_SECONDS)
    })

    it("falls back to default for non-numeric values", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ specialistTimeoutSeconds: "600" })
      )
      expect(resolveSpecialistTimeoutSeconds(tmpDir)).toBe(DEFAULT_SPECIALIST_TIMEOUT_SECONDS)
    })

    it("floors fractional values", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ specialistTimeoutSeconds: 450.7 })
      )
      expect(resolveSpecialistTimeoutSeconds(tmpDir)).toBe(450)
    })
  })

  describe("resolvePhaseBudgetLimit", () => {
    it("returns the default when not set", () => {
      expect(resolvePhaseBudgetLimit(tmpDir)).toBe(DEFAULT_PHASE_BUDGET_LIMIT_USD)
    })
    it("reads planner.phaseBudgetLimit from settings", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ planner: { phaseBudgetLimit: 25 } }),
      )
      expect(resolvePhaseBudgetLimit(tmpDir)).toBe(25)
    })
    it("falls back to default for non-positive values", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ planner: { phaseBudgetLimit: 0 } }),
      )
      expect(resolvePhaseBudgetLimit(tmpDir)).toBe(DEFAULT_PHASE_BUDGET_LIMIT_USD)
    })
  })

  describe("resolvePhaseTokenLimit", () => {
    it("returns the default when not set", () => {
      expect(resolvePhaseTokenLimit(tmpDir)).toBe(DEFAULT_PHASE_TOKEN_LIMIT)
    })
    it("reads planner.phaseTokenLimit from settings", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ planner: { phaseTokenLimit: 100000 } }),
      )
      expect(resolvePhaseTokenLimit(tmpDir)).toBe(100000)
    })
  })

  describe("resolveSpecialistCount", () => {
    it("returns the default (3) when not set", () => {
      expect(resolveSpecialistCount(tmpDir)).toBe(DEFAULT_SPECIALIST_COUNT)
    })
    it("CLI override wins over settings", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ planner: { specialistCount: 2 } }),
      )
      expect(resolveSpecialistCount(tmpDir, 1)).toBe(1)
    })
    it("settings value used when CLI is absent", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ planner: { specialistCount: 2 } }),
      )
      expect(resolveSpecialistCount(tmpDir)).toBe(2)
    })
    it("rejects invalid values and falls back to default", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ planner: { specialistCount: 5 } }),
      )
      expect(resolveSpecialistCount(tmpDir)).toBe(DEFAULT_SPECIALIST_COUNT)
    })
  })

  describe("resolveDirectionCount", () => {
    it("returns the default (2) when not set", () => {
      expect(resolveDirectionCount(tmpDir)).toBe(DEFAULT_DIRECTION_COUNT)
      expect(DEFAULT_DIRECTION_COUNT).toBe(2)
    })
    it("CLI override wins over settings", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ directions: { count: 2 } }),
      )
      expect(resolveDirectionCount(tmpDir, 3)).toBe(3)
    })
    it("settings value used when CLI is absent", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ directions: { count: 3 } }),
      )
      expect(resolveDirectionCount(tmpDir)).toBe(3)
    })
    it("rejects invalid values and falls back to default", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ directions: { count: 4 } }),
      )
      expect(resolveDirectionCount(tmpDir)).toBe(DEFAULT_DIRECTION_COUNT)
    })
    it("ignores invalid CLI override and uses settings", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ directions: { count: 3 } }),
      )
      expect(resolveDirectionCount(tmpDir, 99)).toBe(3)
    })
  })

  describe("resolveSandboxMode", () => {
    it("defaults to semi-locked", () => {
      expect(resolveSandboxMode(tmpDir)).toBe(DEFAULT_SANDBOX_MODE)
      expect(DEFAULT_SANDBOX_MODE).toBe("semi-locked")
    })
    it("CLI override wins over settings", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ sandbox: { mode: "strict" } }),
      )
      expect(resolveSandboxMode(tmpDir, "off")).toBe("off")
    })
    it("reads sandbox.mode from settings", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ sandbox: { mode: "strict" } }),
      )
      expect(resolveSandboxMode(tmpDir)).toBe("strict")
    })
    it("rejects unknown modes and uses default", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ sandbox: { mode: "permissive" } }),
      )
      expect(resolveSandboxMode(tmpDir)).toBe(DEFAULT_SANDBOX_MODE)
    })
  })

  describe("resolveSandboxExtras", () => {
    it("returns empty arrays when nothing is configured", () => {
      expect(resolveSandboxExtras(tmpDir)).toEqual({
        writePaths: [],
        readPaths: [],
        profiles: [],
        networkAllowlist: [],
      })
    })
    it("reads each extras list from settings", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({
          sandbox: {
            extraWritePaths: ["/a"],
            extraReadPaths: ["/b"],
            extraProfiles: ["python"],
            extraNetworkAllowlist: ["example.com"],
          },
        }),
      )
      expect(resolveSandboxExtras(tmpDir)).toEqual({
        writePaths: ["/a"],
        readPaths: ["/b"],
        profiles: ["python"],
        networkAllowlist: ["example.com"],
      })
    })
    it("filters out non-string values", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({
          sandbox: { extraWritePaths: ["/a", 42, null, "/b"] },
        }),
      )
      expect(resolveSandboxExtras(tmpDir).writePaths).toEqual(["/a", "/b"])
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
