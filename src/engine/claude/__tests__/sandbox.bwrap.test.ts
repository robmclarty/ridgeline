import { describe, it, expect } from "vitest"
import { bwrapProvider } from "../sandbox.bwrap"

describe("bwrapProvider", () => {
  it("has name 'bwrap' and command 'bwrap'", () => {
    expect(bwrapProvider.name).toBe("bwrap")
    expect(bwrapProvider.command).toBe("bwrap")
  })

  it("returns args with network blocked and repo writable", () => {
    const args = bwrapProvider.buildArgs("/home/user/project", ["registry.npmjs.org"])

    expect(args).toContain("--ro-bind")
    expect(args).toContain("--unshare-net")
    expect(args).toContain("--die-with-parent")

    const bindIdx = args.indexOf("--bind")
    expect(args[bindIdx + 1]).toBe("/home/user/project")
    expect(args[bindIdx + 2]).toBe("/home/user/project")
  })

  it("ignores the network allowlist (bwrap has no domain filtering)", () => {
    const args = bwrapProvider.buildArgs("/repo", ["registry.npmjs.org", "github.com"])
    expect(args).toContain("--unshare-net")
    expect(args.join(" ")).not.toContain("registry.npmjs.org")
  })

  it("mounts /tmp as writable", () => {
    const args = bwrapProvider.buildArgs("/repo", [])
    const bindIndices = args.reduce<number[]>((acc, val, idx) => {
      if (val === "--bind") acc.push(idx)
      return acc
    }, [])
    const tmpBind = bindIndices.find((idx) => args[idx + 1] === "/tmp")
    expect(tmpBind).toBeDefined()
  })

  it("mounts / as read-only", () => {
    const args = bwrapProvider.buildArgs("/repo", [])
    const roIdx = args.indexOf("--ro-bind")
    expect(args[roIdx + 1]).toBe("/")
    expect(args[roIdx + 2]).toBe("/")
  })
})
