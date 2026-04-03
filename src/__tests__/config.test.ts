import { describe, it, expect, vi, beforeEach } from "vitest"
import * as path from "node:path"

vi.mock("../store/inputs", () => ({
  resolveFile: vi.fn(),
  parseCheckCommand: vi.fn(),
}))

import { resolveConfig, loadVersion } from "../config"
import { resolveFile, parseCheckCommand } from "../store/inputs"

const mockResolveFile = vi.mocked(resolveFile)
const mockParseCheckCommand = vi.mocked(parseCheckCommand)

describe("config", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe("loadVersion", () => {
    it("returns a version string", () => {
      const version = loadVersion()
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    })
  })

  describe("resolveConfig", () => {
    it("throws when constraints.md is not found", () => {
      mockResolveFile.mockReturnValue(null)

      expect(() => resolveConfig("test-build", {})).toThrow("constraints.md not found")
    })

    it("returns config with correct paths", () => {
      mockResolveFile.mockImplementation((_flag, _buildDir, filename) => {
        if (filename === "constraints.md") return "/fake/constraints.md"
        return null
      })
      mockParseCheckCommand.mockReturnValue(null)

      const config = resolveConfig("my-build", {})
      const cwd = process.cwd()

      expect(config.buildName).toBe("my-build")
      expect(config.ridgelineDir).toBe(path.join(cwd, ".ridgeline"))
      expect(config.buildDir).toBe(path.join(cwd, ".ridgeline", "builds", "my-build"))
      expect(config.phasesDir).toBe(path.join(cwd, ".ridgeline", "builds", "my-build", "phases"))
      expect(config.constraintsPath).toBe("/fake/constraints.md")
      expect(config.handoffPath).toBe(path.join(cwd, ".ridgeline", "builds", "my-build", "handoff.md"))
    })

    it("uses default values for optional fields", () => {
      mockResolveFile.mockImplementation((_flag, _buildDir, filename) => {
        if (filename === "constraints.md") return "/fake/constraints.md"
        return null
      })
      mockParseCheckCommand.mockReturnValue(null)

      const config = resolveConfig("test", {})

      expect(config.model).toBe("opus")
      expect(config.maxRetries).toBe(2)
      expect(config.timeoutMinutes).toBe(120)
      expect(config.checkTimeoutSeconds).toBe(1200)
      expect(config.checkCommand).toBeNull()
      expect(config.tastePath).toBeNull()
      expect(config.maxBudgetUsd).toBeNull()
    })

    it("overrides defaults with CLI options", () => {
      mockResolveFile.mockImplementation((_flag, _buildDir, filename) => {
        if (filename === "constraints.md") return "/fake/constraints.md"
        if (filename === "taste.md") return "/fake/taste.md"
        return null
      })
      mockParseCheckCommand.mockReturnValue(null)

      const config = resolveConfig("test", {
        model: "sonnet",
        maxRetries: "5",
        timeout: "60",
        checkTimeout: "300",
        check: "npm test",
        maxBudgetUsd: "10.50",
      })

      expect(config.model).toBe("sonnet")
      expect(config.maxRetries).toBe(5)
      expect(config.timeoutMinutes).toBe(60)
      expect(config.checkTimeoutSeconds).toBe(300)
      expect(config.checkCommand).toBe("npm test")
      expect(config.maxBudgetUsd).toBe(10.50)
    })

    it("uses check command from constraints when not provided via CLI", () => {
      mockResolveFile.mockImplementation((_flag, _buildDir, filename) => {
        if (filename === "constraints.md") return "/fake/constraints.md"
        return null
      })
      mockParseCheckCommand.mockReturnValue("make test")

      const config = resolveConfig("test", {})
      expect(config.checkCommand).toBe("make test")
    })

    it("CLI check flag takes precedence over constraints", () => {
      mockResolveFile.mockImplementation((_flag, _buildDir, filename) => {
        if (filename === "constraints.md") return "/fake/constraints.md"
        return null
      })
      mockParseCheckCommand.mockReturnValue("make test")

      const config = resolveConfig("test", { check: "npm run lint" })
      expect(config.checkCommand).toBe("npm run lint")
    })

    it("defaults sandbox and allowNetwork to false", () => {
      mockResolveFile.mockImplementation((_flag, _buildDir, filename) => {
        if (filename === "constraints.md") return "/fake/constraints.md"
        return null
      })
      mockParseCheckCommand.mockReturnValue(null)

      const config = resolveConfig("test", {})

      expect(config.sandbox).toBe(false)
      expect(config.allowNetwork).toBe(false)
    })

    it("sets sandbox and allowNetwork from CLI opts", () => {
      mockResolveFile.mockImplementation((_flag, _buildDir, filename) => {
        if (filename === "constraints.md") return "/fake/constraints.md"
        return null
      })
      mockParseCheckCommand.mockReturnValue(null)

      const config = resolveConfig("test", { sandbox: true, allowNetwork: true })

      expect(config.sandbox).toBe(true)
      expect(config.allowNetwork).toBe(true)
    })
  })
})
