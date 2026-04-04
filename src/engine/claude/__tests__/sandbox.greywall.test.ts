import { describe, it, expect } from "vitest"
import { greywallProvider } from "../sandbox.greywall"

describe("greywallProvider", () => {
  it("has name 'greywall' and command 'greywall'", () => {
    expect(greywallProvider.name).toBe("greywall")
    expect(greywallProvider.command).toBe("greywall")
  })

  it("returns --auto-profile and -- separator", () => {
    const args = greywallProvider.buildArgs("/repo", [])
    expect(args).toEqual(["--auto-profile", "--no-credential-protection", "--"])
  })
})
