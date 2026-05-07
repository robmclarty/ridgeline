import { describe, expect, it } from "vitest"
import { parseBuilderMarker } from "../builder.marker.js"

describe("parseBuilderMarker", () => {
  it("recognizes a clean READY_FOR_REVIEW final line", () => {
    const text = "Finished phase 1.\nAll criteria met.\nREADY_FOR_REVIEW"
    expect(parseBuilderMarker(text)).toEqual({ kind: "ready_for_review" })
  })

  it("recognizes MORE_WORK_NEEDED with a reason", () => {
    const text = "Wrote scaffolding.\nMORE_WORK_NEEDED: tests still pending for the loop module"
    expect(parseBuilderMarker(text)).toEqual({
      kind: "more_work_needed",
      reason: "tests still pending for the loop module",
      explicit: true,
    })
  })

  it("treats missing markers as implicit more_work_needed", () => {
    const text = "Did some work but the model just stopped."
    const result = parseBuilderMarker(text)
    expect(result.kind).toBe("more_work_needed")
    if (result.kind === "more_work_needed") {
      expect(result.explicit).toBe(false)
      expect(result.reason).toBe("no marker emitted")
    }
  })

  it("tolerates trailing whitespace and blank lines", () => {
    const text = "All done.\n\n  READY_FOR_REVIEW   \n\n\n"
    expect(parseBuilderMarker(text)).toEqual({ kind: "ready_for_review" })
  })

  it("strips ANSI escape codes around the marker", () => {
    const ESC = String.fromCharCode(27)
    const text = `Final answer.\n${ESC}[32mREADY_FOR_REVIEW${ESC}[0m`
    expect(parseBuilderMarker(text)).toEqual({ kind: "ready_for_review" })
  })

  it("strips surrounding markdown backticks", () => {
    const text = "Wrap-up.\n`READY_FOR_REVIEW`"
    expect(parseBuilderMarker(text)).toEqual({ kind: "ready_for_review" })
  })

  it("uses the LAST marker when multiple appear", () => {
    const text = [
      "When you finish a phase write `READY_FOR_REVIEW` on its own line.",
      "But not yet — I have more to do.",
      "MORE_WORK_NEEDED: still implementing reviewer integration",
    ].join("\n")
    const result = parseBuilderMarker(text)
    expect(result.kind).toBe("more_work_needed")
    if (result.kind === "more_work_needed") {
      expect(result.reason).toBe("still implementing reviewer integration")
    }
  })

  it("uses 'no reason given' when MORE_WORK_NEEDED has an empty reason", () => {
    const text = "MORE_WORK_NEEDED: "
    const result = parseBuilderMarker(text)
    expect(result.kind).toBe("more_work_needed")
    if (result.kind === "more_work_needed") {
      expect(result.reason).toBe("no reason given")
      expect(result.explicit).toBe(true)
    }
  })

  it("ignores marker substrings that are not on their own line", () => {
    const text = "We will emit READY_FOR_REVIEW once tests pass; for now keep going."
    const result = parseBuilderMarker(text)
    expect(result.kind).toBe("more_work_needed")
    if (result.kind === "more_work_needed") {
      expect(result.explicit).toBe(false)
    }
  })

  it("returns implicit more_work_needed for an empty result", () => {
    const result = parseBuilderMarker("")
    expect(result.kind).toBe("more_work_needed")
    if (result.kind === "more_work_needed") {
      expect(result.explicit).toBe(false)
    }
  })
})
