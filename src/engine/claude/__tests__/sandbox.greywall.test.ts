import { describe, it, expect } from "vitest"
import { greywallProvider } from "../sandbox.greywall"

describe("greywallProvider", () => {
  it("has name 'greywall' and command 'greywall'", () => {
    expect(greywallProvider.name).toBe("greywall")
    expect(greywallProvider.command).toBe("greywall")
  })

  it("allows the repo directory and /tmp", () => {
    const args = greywallProvider.buildArgs("/my/repo", [])

    expect(args).toContain("--allow-dir")
    const dirIndices = args.reduce<number[]>((acc, val, idx) => {
      if (val === "--allow-dir") acc.push(idx)
      return acc
    }, [])
    const dirs = dirIndices.map((i) => args[i + 1])
    expect(dirs).toContain("/my/repo")
    expect(dirs).toContain("/tmp")
  })

  it("passes each domain in the allowlist as --allow-network", () => {
    const args = greywallProvider.buildArgs("/repo", [
      "registry.npmjs.org",
      "github.com",
    ])

    const netIndices = args.reduce<number[]>((acc, val, idx) => {
      if (val === "--allow-network") acc.push(idx)
      return acc
    }, [])
    const domains = netIndices.map((i) => args[i + 1])
    expect(domains).toContain("registry.npmjs.org")
    expect(domains).toContain("github.com")
  })

  it("ends with -- separator", () => {
    const args = greywallProvider.buildArgs("/repo", [])
    expect(args[args.length - 1]).toBe("--")
  })

  it("produces no --allow-network flags when allowlist is empty", () => {
    const args = greywallProvider.buildArgs("/repo", [])
    expect(args).not.toContain("--allow-network")
  })
})
