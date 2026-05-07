import { describe, it, expect, vi } from "vitest"

vi.mock("../../ui/output.js", () => ({
  printInfo: vi.fn(),
}))

import { runClean } from "../clean.js"

describe("commands/clean", () => {
  it("does not throw", () => {
    expect(() => runClean("/tmp")).not.toThrow()
  })
})
