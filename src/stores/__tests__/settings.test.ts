import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup.js"
import {
  loadSettings,
  resolveNetworkAllowlist,
  resolveModel,
  resolveSpecialistTimeoutSeconds,
  resolvePhaseBudgetLimit,
  resolvePhaseTokenLimit,
  resolveTimeoutMinutes,
  UNLIMITED_TIMEOUT_CATCHALL_MINUTES,
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
  DEFAULT_SEQUENCING,
  CLAUDE_REQUIRED_DOMAINS,
  parseSequencing,
  resolveSequencing,
  resolvePreflight,
  resolveMaxBudgetUsd,
  resolveEnginePricing,
  DEFAULT_PREFLIGHT,
} from "../settings.js"

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

  describe("resolvePreflight", () => {
    const writeSettings = (obj: unknown): void =>
      fs.writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify(obj))

    it("defaults to DEFAULT_PREFLIGHT (true) when unset", () => {
      expect(resolvePreflight(tmpDir)).toBe(DEFAULT_PREFLIGHT)
      expect(resolvePreflight(tmpDir)).toBe(true)
    })

    it("reads the settings.json value", () => {
      writeSettings({ preflight: false })
      expect(resolvePreflight(tmpDir)).toBe(false)
    })

    it("CLI override wins over settings.json", () => {
      writeSettings({ preflight: true })
      expect(resolvePreflight(tmpDir, false)).toBe(false)
    })

    it("ignores non-boolean settings values and falls back to the default", () => {
      writeSettings({ preflight: "nope" })
      expect(resolvePreflight(tmpDir)).toBe(true)
    })
  })

  describe("resolveEnginePricing", () => {
    const writeSettings = (obj: unknown): void =>
      fs.writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify(obj))

    it("returns [] when pricing is unset", () => {
      expect(resolveEnginePricing(tmpDir)).toEqual([])
    })

    it("splits a provider:model_id key into provider + modelId", () => {
      writeSettings({
        pricing: {
          "openrouter:qwen/qwen3-coder-30b-a3b-instruct": { input_per_million: 0.07, output_per_million: 0.26 },
        },
      })
      expect(resolveEnginePricing(tmpDir)).toEqual([
        {
          provider: "openrouter",
          modelId: "qwen/qwen3-coder-30b-a3b-instruct",
          pricing: { input_per_million: 0.07, output_per_million: 0.26 },
        },
      ])
    })

    it("skips malformed keys (no provider segment or trailing colon)", () => {
      writeSettings({
        pricing: {
          "no-colon": { input_per_million: 1, output_per_million: 2 },
          "trailing:": { input_per_million: 1, output_per_million: 2 },
          "openrouter:good": { input_per_million: 1, output_per_million: 2 },
        },
      })
      const entries = resolveEnginePricing(tmpDir)
      expect(entries).toHaveLength(1)
      expect(entries[0].provider).toBe("openrouter")
      expect(entries[0].modelId).toBe("good")
    })
  })

  describe("resolveMaxBudgetUsd", () => {
    const writeSettings = (obj: unknown): void =>
      fs.writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify(obj))

    it("defaults to null (no cap) when unset", () => {
      expect(resolveMaxBudgetUsd(tmpDir)).toBeNull()
    })

    it("reads a numeric settings.json value", () => {
      writeSettings({ maxBudgetUsd: 5 })
      expect(resolveMaxBudgetUsd(tmpDir)).toBe(5)
    })

    it("CLI override (string) wins over settings.json", () => {
      writeSettings({ maxBudgetUsd: 5 })
      expect(resolveMaxBudgetUsd(tmpDir, "9.5")).toBe(9.5)
    })

    it("ignores non-positive or non-finite values and falls back", () => {
      writeSettings({ maxBudgetUsd: 0 })
      expect(resolveMaxBudgetUsd(tmpDir)).toBeNull()
      expect(resolveMaxBudgetUsd(tmpDir, "abc")).toBeNull()
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
    it("returns null when settings sets phaseBudgetLimit: null", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ planner: { phaseBudgetLimit: null } }),
      )
      expect(resolvePhaseBudgetLimit(tmpDir)).toBeNull()
    })
    it("returns null when settings sets phaseBudgetLimit: 'unlimited'", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ planner: { phaseBudgetLimit: "unlimited" } }),
      )
      expect(resolvePhaseBudgetLimit(tmpDir)).toBeNull()
    })
  })

  describe("resolveTimeoutMinutes", () => {
    it("returns the default when no CLI override and no settings", () => {
      expect(resolveTimeoutMinutes(tmpDir, undefined, 120)).toBe(120)
    })
    it("CLI numeric string wins over settings", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ timeoutMinutes: 30 }),
      )
      expect(resolveTimeoutMinutes(tmpDir, "60", 120)).toBe(60)
    })
    it("CLI 'unlimited' maps to the catchall", () => {
      expect(resolveTimeoutMinutes(tmpDir, "unlimited", 120)).toBe(UNLIMITED_TIMEOUT_CATCHALL_MINUTES)
    })
    it("settings 'unlimited' maps to the catchall", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ timeoutMinutes: "unlimited" }),
      )
      expect(resolveTimeoutMinutes(tmpDir, undefined, 120)).toBe(UNLIMITED_TIMEOUT_CATCHALL_MINUTES)
    })
    it("settings null maps to the catchall", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ timeoutMinutes: null }),
      )
      expect(resolveTimeoutMinutes(tmpDir, undefined, 120)).toBe(UNLIMITED_TIMEOUT_CATCHALL_MINUTES)
    })
    it("settings numeric value is honored", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ timeoutMinutes: 45 }),
      )
      expect(resolveTimeoutMinutes(tmpDir, undefined, 120)).toBe(45)
    })
    it("invalid CLI string falls back to default", () => {
      expect(resolveTimeoutMinutes(tmpDir, "garbage", 120)).toBe(120)
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

  describe("parseSequencing", () => {
    it("parses 'sequential'", () => {
      expect(parseSequencing("sequential")).toEqual({ kind: "sequential" })
    })

    it("parses 'manual'", () => {
      expect(parseSequencing("manual")).toEqual({ kind: "manual" })
    })

    it("parses 'wave' as unbounded", () => {
      expect(parseSequencing("wave")).toEqual({ kind: "wave", maxConcurrency: Infinity })
    })

    it("parses 'wave-2' as bounded", () => {
      expect(parseSequencing("wave-2")).toEqual({ kind: "wave", maxConcurrency: 2 })
    })

    it("parses 'wave-10' as bounded", () => {
      expect(parseSequencing("wave-10")).toEqual({ kind: "wave", maxConcurrency: 10 })
    })

    it("rejects 'wave-0' (N must be ≥ 1)", () => {
      expect(parseSequencing("wave-0")).toBeNull()
    })

    it("rejects 'wave-' (no number)", () => {
      expect(parseSequencing("wave-")).toBeNull()
    })

    it("rejects unknown strings", () => {
      expect(parseSequencing("foo")).toBeNull()
      expect(parseSequencing("WAVE")).toBeNull()
      expect(parseSequencing("wave-abc")).toBeNull()
    })

    it("rejects non-strings", () => {
      expect(parseSequencing(undefined)).toBeNull()
      expect(parseSequencing(null)).toBeNull()
      expect(parseSequencing(42)).toBeNull()
      expect(parseSequencing({})).toBeNull()
    })
  })

  describe("resolveSequencing", () => {
    it("returns the default when nothing is set", () => {
      expect(resolveSequencing(tmpDir)).toEqual(DEFAULT_SEQUENCING)
    })

    it("reads build.sequencing from settings.json", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ build: { sequencing: "wave-3" } }),
      )
      expect(resolveSequencing(tmpDir)).toEqual({ kind: "wave", maxConcurrency: 3 })
    })

    it("CLI override beats settings.json", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ build: { sequencing: "wave" } }),
      )
      expect(resolveSequencing(tmpDir, "manual")).toEqual({ kind: "manual" })
    })

    it("falls back to settings.json when CLI override is invalid", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ build: { sequencing: "wave" } }),
      )
      expect(resolveSequencing(tmpDir, "not-a-mode")).toEqual({
        kind: "wave",
        maxConcurrency: Infinity,
      })
    })

    it("falls back to default when settings value is invalid", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ build: { sequencing: "garbage" } }),
      )
      expect(resolveSequencing(tmpDir)).toEqual(DEFAULT_SEQUENCING)
    })
  })

  describe("DEFAULT_SEQUENCING", () => {
    it("is sequential", () => {
      expect(DEFAULT_SEQUENCING).toEqual({ kind: "sequential" })
    })
  })
})
