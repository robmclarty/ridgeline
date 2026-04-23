import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { detectFlavourFlag, flavourRemovedMessage, enforceFlavourRemoved } from "../flavour-removed"

const PIPELINE_COMMANDS = [
  "shape",
  "design",
  "spec",
  "research",
  "refine",
  "plan",
  "build",
  "rewind",
  "retrospective",
  "create",
] as const

const SAMPLE_FLAVOURS = [
  "web-ui",
  "novel-writing",
  "game-dev",
  "/abs/path/to/custom",
] as const

describe("detectFlavourFlag", () => {
  it("returns null when --flavour is absent", () => {
    expect(detectFlavourFlag(["build", "my-build"])).toBeNull()
  })

  it("detects --flavour <value>", () => {
    expect(detectFlavourFlag(["build", "my", "--flavour", "web-ui"])).toBe("web-ui")
  })

  it("detects --flavour=<value>", () => {
    expect(detectFlavourFlag(["build", "--flavour=web-ui"])).toBe("web-ui")
  })

  it("detects American spelling --flavor", () => {
    expect(detectFlavourFlag(["plan", "--flavor", "game-dev"])).toBe("game-dev")
  })
})

describe("flavourRemovedMessage", () => {
  it("contains the literal substring 'removed in 0.8.0'", () => {
    expect(flavourRemovedMessage("web-ui")).toContain("removed in 0.8.0")
  })

  it("contains the literal substring 'drop the --flavour flag'", () => {
    expect(flavourRemovedMessage("web-ui")).toContain("drop the --flavour flag")
  })

  it("names the supplied flavour", () => {
    expect(flavourRemovedMessage("novel-writing")).toContain("novel-writing")
  })
})

describe("enforceFlavourRemoved — parameterised across all pipeline-entry commands", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit:${code}__`)
    }) as never)
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("does not exit when --flavour is absent", () => {
    expect(() => enforceFlavourRemoved(["build", "my-build"])).not.toThrow()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  for (const cmd of PIPELINE_COMMANDS) {
    for (const flavour of SAMPLE_FLAVOURS) {
      it(`'ridgeline ${cmd} --flavour ${flavour}' exits non-zero with the deprecation error`, () => {
        expect(() =>
          enforceFlavourRemoved([cmd, "test-build", "--flavour", flavour]),
        ).toThrow(/__exit:1__/)

        const stderr = errorSpy.mock.calls.flat().join("\n")
        expect(stderr).toContain("removed in 0.8.0")
        expect(stderr).toContain("drop the --flavour flag")
        expect(stderr).toContain(flavour)
      })
    }
  }
})
