import { describe, it, expect, vi } from "vitest"

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
}))

import { runClean } from "../clean"

describe("commands/clean", () => {
  it("does not throw", () => {
    expect(() => runClean("/tmp")).not.toThrow()
  })
})
