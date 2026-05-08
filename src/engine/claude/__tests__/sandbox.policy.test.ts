import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { homedir } from "node:os"

import {
  buildSandboxPolicy,
  DEFAULT_NETWORK_ALLOWLIST_SEMI_LOCKED,
  DEFAULT_NETWORK_ALLOWLIST_STRICT,
} from "../sandbox.policy.js"

const REPO_ROOT = path.resolve(__dirname, "../../../..")
const BASELINE_DIR = path.join(
  REPO_ROOT,
  ".ridgeline",
  "builds",
  "fascicle-migration",
  "baseline",
)

const readBaselineHosts = (filename: string): string[] => {
  const raw = fs.readFileSync(path.join(BASELINE_DIR, filename), "utf-8")
  return JSON.parse(raw).hosts as string[]
}

describe("buildSandboxPolicy", () => {
  describe("flag → policy shape", () => {
    it("returns undefined when sandboxFlag is 'off'", () => {
      const result = buildSandboxPolicy({ sandboxFlag: "off", buildPath: "/repo/.ridgeline/builds/x" })
      expect(result).toBeUndefined()
    })

    it("returns { kind: 'greywall', ... } for 'semi-locked'", () => {
      const result = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/repo/.ridgeline/builds/x" })
      expect(result).toBeDefined()
      expect(result!.kind).toBe("greywall")
      expect(Array.isArray(result!.network_allowlist)).toBe(true)
      expect(Array.isArray(result!.additional_write_paths)).toBe(true)
    })

    it("returns { kind: 'greywall', ... } for 'strict'", () => {
      const result = buildSandboxPolicy({ sandboxFlag: "strict", buildPath: "/repo/.ridgeline/builds/x" })
      expect(result).toBeDefined()
      expect(result!.kind).toBe("greywall")
      expect(Array.isArray(result!.network_allowlist)).toBe(true)
      expect(Array.isArray(result!.additional_write_paths)).toBe(true)
    })
  })

  describe("default network allowlists (no widening)", () => {
    it("DEFAULT_NETWORK_ALLOWLIST_SEMI_LOCKED equals baseline sandbox-allowlist.semi-locked.json hosts", () => {
      const baseline = readBaselineHosts("sandbox-allowlist.semi-locked.json")
      expect([...DEFAULT_NETWORK_ALLOWLIST_SEMI_LOCKED]).toEqual(baseline)
    })

    it("DEFAULT_NETWORK_ALLOWLIST_STRICT equals baseline sandbox-allowlist.strict.json hosts", () => {
      const baseline = readBaselineHosts("sandbox-allowlist.strict.json")
      expect([...DEFAULT_NETWORK_ALLOWLIST_STRICT]).toEqual(baseline)
    })

    it("buildSandboxPolicy('semi-locked') yields network_allowlist deep-equal to the baseline", () => {
      const baseline = readBaselineHosts("sandbox-allowlist.semi-locked.json")
      const result = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/x" })
      expect([...(result!.network_allowlist ?? [])]).toEqual(baseline)
    })

    it("buildSandboxPolicy('strict') yields network_allowlist deep-equal to the baseline", () => {
      const baseline = readBaselineHosts("sandbox-allowlist.strict.json")
      const result = buildSandboxPolicy({ sandboxFlag: "strict", buildPath: "/x" })
      expect([...(result!.network_allowlist ?? [])]).toEqual(baseline)
    })

    it("DEFAULT_NETWORK_ALLOWLIST_SEMI_LOCKED is frozen to prevent runtime mutation", () => {
      expect(Object.isFrozen(DEFAULT_NETWORK_ALLOWLIST_SEMI_LOCKED)).toBe(true)
    })

    it("DEFAULT_NETWORK_ALLOWLIST_STRICT is frozen to prevent runtime mutation", () => {
      expect(Object.isFrozen(DEFAULT_NETWORK_ALLOWLIST_STRICT)).toBe(true)
    })
  })

  describe("additional_write_paths always contains buildPath", () => {
    it("places buildPath at index 0 for 'semi-locked'", () => {
      const result = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/repo/.ridgeline/builds/foo" })
      expect(result!.additional_write_paths![0]).toBe("/repo/.ridgeline/builds/foo")
    })

    it("places buildPath at index 0 for 'strict'", () => {
      const result = buildSandboxPolicy({ sandboxFlag: "strict", buildPath: "/repo/.ridgeline/builds/bar" })
      expect(result!.additional_write_paths![0]).toBe("/repo/.ridgeline/builds/bar")
    })

    it("resolves additional_write_paths per-build (different buildPath inputs produce different resolved paths)", () => {
      const a = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/repo/.ridgeline/builds/A" })
      const b = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/repo/.ridgeline/builds/B" })
      expect(a!.additional_write_paths![0]).toBe("/repo/.ridgeline/builds/A")
      expect(b!.additional_write_paths![0]).toBe("/repo/.ridgeline/builds/B")
      expect(a!.additional_write_paths![0]).not.toBe(b!.additional_write_paths![0])
    })

    it("contains exactly buildPath + /tmp for 'strict' (no extra paths beyond the documented set)", () => {
      const result = buildSandboxPolicy({ sandboxFlag: "strict", buildPath: "/repo/build" })
      expect([...(result!.additional_write_paths ?? [])]).toEqual(["/repo/build", "/tmp"])
    })

    it("contains buildPath + /tmp + the semi-locked cache directories for 'semi-locked'", () => {
      const result = buildSandboxPolicy({ sandboxFlag: "semi-locked", buildPath: "/repo/build" })
      const home = homedir()
      const expected = [
        "/repo/build",
        "/tmp",
        `${home}/.agent-browser`,
        `${home}/.cache/uv`,
        `${home}/.cache/pip`,
        `${home}/.cache/playwright`,
        `${home}/Library/Caches/Cypress`,
        `${home}/Library/Caches/ms-playwright`,
      ]
      expect([...(result!.additional_write_paths ?? [])]).toEqual(expected)
    })
  })
})
