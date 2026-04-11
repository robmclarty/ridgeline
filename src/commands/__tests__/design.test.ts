import { describe, it, expect } from "vitest"
import { resolveDesignOutputPath } from "../design"

describe("resolveDesignOutputPath", () => {
  it("returns build-level path when buildDir is provided", () => {
    const result = resolveDesignOutputPath("/builds/my-build", "/ridgeline")
    expect(result).toBe("/builds/my-build/design.md")
  })

  it("returns project-level path when no buildDir", () => {
    const result = resolveDesignOutputPath(null, "/ridgeline")
    expect(result).toBe("/ridgeline/design.md")
  })
})
