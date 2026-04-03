// src/engine/claude/__tests__/sandbox.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}))

import { execSync } from "node:child_process"
import { buildBwrapArgs, assertBwrapAvailable } from "../sandbox"

describe("sandbox", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe("buildBwrapArgs", () => {
    it("returns args with network blocked by default", () => {
      const args = buildBwrapArgs("/home/user/project", false)

      expect(args).toContain("--ro-bind")
      expect(args).toContain("--bind")
      expect(args).toContain("--unshare-net")
      expect(args).toContain("--die-with-parent")

      const bindIdx = args.indexOf("--bind")
      expect(args[bindIdx + 1]).toBe("/home/user/project")
      expect(args[bindIdx + 2]).toBe("/home/user/project")
    })

    it("omits --unshare-net when allowNetwork is true", () => {
      const args = buildBwrapArgs("/home/user/project", true)
      expect(args).not.toContain("--unshare-net")
    })

    it("mounts /tmp as writable", () => {
      const args = buildBwrapArgs("/repo", false)

      const bindIndices = args.reduce<number[]>((acc, val, idx) => {
        if (val === "--bind") acc.push(idx)
        return acc
      }, [])

      const tmpBind = bindIndices.find((idx) => args[idx + 1] === "/tmp")
      expect(tmpBind).toBeDefined()
      expect(args[tmpBind! + 2]).toBe("/tmp")
    })

    it("mounts / as read-only", () => {
      const args = buildBwrapArgs("/repo", false)

      const roIdx = args.indexOf("--ro-bind")
      expect(args[roIdx + 1]).toBe("/")
      expect(args[roIdx + 2]).toBe("/")
    })

    it("includes --dev /dev and --proc /proc", () => {
      const args = buildBwrapArgs("/repo", false)

      const devIdx = args.indexOf("--dev")
      expect(args[devIdx + 1]).toBe("/dev")

      const procIdx = args.indexOf("--proc")
      expect(args[procIdx + 1]).toBe("/proc")
    })
  })

  describe("assertBwrapAvailable", () => {
    it("does not throw when bwrap is found", () => {
      vi.mocked(execSync).mockReturnValue("/usr/bin/bwrap")
      expect(() => assertBwrapAvailable()).not.toThrow()
    })

    it("throws with install hint when bwrap is not found", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found")
      })
      expect(() => assertBwrapAvailable()).toThrow("--sandbox requires bubblewrap")
      expect(() => assertBwrapAvailable()).toThrow("apt install bubblewrap")
    })
  })
})
