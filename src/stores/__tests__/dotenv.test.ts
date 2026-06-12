import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { dotenvCandidates, loadDotenvFiles } from "../dotenv.js"

describe("dotenv", () => {
  let dir: string
  const touched: string[] = []

  const setEnv = (key: string, value: string): void => {
    touched.push(key)
    process.env[key] = value
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "rl-dotenv-"))
  })

  afterEach(() => {
    for (const key of touched.splice(0)) delete process.env[key]
    rmSync(dir, { recursive: true, force: true })
  })

  const writeProjectEnv = (body: string): void => {
    mkdirSync(path.join(dir, ".ridgeline"), { recursive: true })
    writeFileSync(path.join(dir, ".ridgeline", ".env"), body)
  }

  describe("dotenvCandidates", () => {
    it("includes .ridgeline/.env before the global config file, and never ./.env", () => {
      const candidates = dotenvCandidates(dir)
      expect(candidates[0]).toBe(path.join(dir, ".ridgeline", ".env"))
      expect(candidates).not.toContain(path.join(dir, ".env"))
    })

    it("honors XDG_CONFIG_HOME for the global path", () => {
      setEnv("XDG_CONFIG_HOME", "/custom/xdg")
      expect(dotenvCandidates(dir)).toContain(path.join("/custom/xdg", "ridgeline", ".env"))
    })
  })

  describe("loadDotenvFiles", () => {
    it("loads keys from .ridgeline/.env into process.env", () => {
      touched.push("RL_TEST_KEY")
      writeProjectEnv("RL_TEST_KEY=from-file\n")
      loadDotenvFiles(dir)
      expect(process.env.RL_TEST_KEY).toBe("from-file")
    })

    it("does not override a variable already set in the real environment", () => {
      setEnv("RL_TEST_KEY", "from-real-env")
      writeProjectEnv("RL_TEST_KEY=from-file\n")
      loadDotenvFiles(dir)
      expect(process.env.RL_TEST_KEY).toBe("from-real-env")
    })

    it("is a no-op when no env file exists", () => {
      expect(() => loadDotenvFiles(dir)).not.toThrow()
    })

    it("surfaces the file path when a present env file cannot be loaded", () => {
      // A directory at the .env path makes loadEnvFile fail (EISDIR), standing in
      // for any unreadable/malformed file — the point is the error is not swallowed.
      mkdirSync(path.join(dir, ".ridgeline", ".env"), { recursive: true })
      expect(() => loadDotenvFiles(dir)).toThrow(/Failed to load env file/)
    })
  })
})
