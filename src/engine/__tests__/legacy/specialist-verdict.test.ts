import { describe, it, expect } from "vitest"
import { parseSpecialistVerdict, skeletonsAgree } from "../../specialist-verdict.js"
import type { SpecialistVerdict } from "../../../types.js"

describe("parseSpecialistVerdict", () => {
  describe("spec stage", () => {
    it("parses from top-level object", () => {
      const raw = JSON.stringify({
        sectionOutline: ["auth", "profiles"],
        riskList: ["latency"],
      })
      const result = parseSpecialistVerdict("spec", raw)
      expect(result).toEqual({
        stage: "spec",
        skeleton: { sectionOutline: ["auth", "profiles"], riskList: ["latency"] },
      })
    })

    it("parses from nested _skeleton field", () => {
      const raw = JSON.stringify({
        perspective: "clarity",
        _skeleton: {
          sectionOutline: ["auth", "profiles"],
          riskList: ["latency"],
        },
      })
      const result = parseSpecialistVerdict("spec", raw)
      expect(result?.stage).toBe("spec")
    })

    it("parses from fenced JSON block inside prose", () => {
      const raw = `Some prose here.\n\n\`\`\`json\n${JSON.stringify({
        sectionOutline: ["a"],
        riskList: ["b"],
      })}\n\`\`\`\n`
      const result = parseSpecialistVerdict("spec", raw)
      expect(result).not.toBeNull()
    })

    it("returns null when fields are missing", () => {
      const raw = JSON.stringify({ sectionOutline: ["a"] })
      expect(parseSpecialistVerdict("spec", raw)).toBeNull()
    })

    it("returns null on malformed JSON", () => {
      expect(parseSpecialistVerdict("spec", "not json")).toBeNull()
      expect(parseSpecialistVerdict("spec", "")).toBeNull()
    })

    it("returns null when array items are not strings", () => {
      const raw = JSON.stringify({ sectionOutline: [1, 2], riskList: [] })
      expect(parseSpecialistVerdict("spec", raw)).toBeNull()
    })
  })

  describe("plan stage", () => {
    it("parses phaseList + depGraph", () => {
      const raw = JSON.stringify({
        _skeleton: {
          phaseList: [
            { id: "01-scaffold", slug: "scaffold" },
            { id: "02-api", slug: "api" },
          ],
          depGraph: [["02-api", "01-scaffold"]],
        },
      })
      const result = parseSpecialistVerdict("plan", raw)
      expect(result?.stage).toBe("plan")
      if (result?.stage === "plan") {
        expect(result.skeleton.phaseList.length).toBe(2)
        expect(result.skeleton.depGraph).toEqual([["02-api", "01-scaffold"]])
      }
    })

    it("rejects malformed phaseList entries", () => {
      const raw = JSON.stringify({
        phaseList: [{ id: "01" }],
        depGraph: [],
      })
      expect(parseSpecialistVerdict("plan", raw)).toBeNull()
    })

    it("rejects non-pair depGraph entries", () => {
      const raw = JSON.stringify({
        phaseList: [{ id: "01-x", slug: "x" }],
        depGraph: [["only-one"]],
      })
      expect(parseSpecialistVerdict("plan", raw)).toBeNull()
    })
  })

  describe("research stage", () => {
    it("parses findings + openQuestions", () => {
      const raw = JSON.stringify({
        findings: ["a", "b"],
        openQuestions: ["q1"],
      })
      const result = parseSpecialistVerdict("research", raw)
      expect(result?.stage).toBe("research")
    })

    it("parses a fenced block appended at end of prose", () => {
      const raw = `# Research Report\n\n...prose...\n\n\`\`\`json\n{ "findings": ["x"], "openQuestions": ["y"] }\n\`\`\`\n`
      const result = parseSpecialistVerdict("research", raw)
      expect(result?.stage).toBe("research")
      if (result?.stage === "research") {
        expect(result.skeleton.findings).toEqual(["x"])
      }
    })

    it("returns null when block is missing", () => {
      expect(parseSpecialistVerdict("research", "# just prose")).toBeNull()
    })
  })
})

describe("skeletonsAgree", () => {
  const specA: SpecialistVerdict = {
    stage: "spec",
    skeleton: { sectionOutline: ["auth", "profiles"], riskList: ["latency", "security"] },
  }
  const specB: SpecialistVerdict = {
    stage: "spec",
    skeleton: { sectionOutline: ["profiles", "auth"], riskList: ["security", "latency"] },
  }
  const specC: SpecialistVerdict = {
    stage: "spec",
    skeleton: { sectionOutline: ["auth"], riskList: [] },
  }

  it("agrees when stringset matches (order-insensitive)", () => {
    expect(skeletonsAgree([specA, specB])).toBe(true)
  })

  it("disagrees when outline differs", () => {
    expect(skeletonsAgree([specA, specC])).toBe(false)
  })

  it("returns false when any verdict is null", () => {
    expect(skeletonsAgree([specA, null])).toBe(false)
  })

  it("returns false for a single verdict", () => {
    expect(skeletonsAgree([specA])).toBe(false)
  })

  it("plan agreement requires ordered phaseList", () => {
    const planA: SpecialistVerdict = {
      stage: "plan",
      skeleton: {
        phaseList: [
          { id: "01-a", slug: "a" },
          { id: "02-b", slug: "b" },
        ],
        depGraph: [],
      },
    }
    const planB: SpecialistVerdict = {
      stage: "plan",
      skeleton: {
        phaseList: [
          { id: "02-b", slug: "b" },
          { id: "01-a", slug: "a" },
        ],
        depGraph: [],
      },
    }
    expect(skeletonsAgree([planA, planB])).toBe(false)
  })

  it("plan agreement is order-insensitive for depGraph edges", () => {
    const planA: SpecialistVerdict = {
      stage: "plan",
      skeleton: {
        phaseList: [
          { id: "01-a", slug: "a" },
          { id: "02-b", slug: "b" },
        ],
        depGraph: [
          ["02-b", "01-a"],
          ["03-c", "02-b"],
        ],
      },
    }
    const planB: SpecialistVerdict = {
      stage: "plan",
      skeleton: {
        phaseList: [
          { id: "01-a", slug: "a" },
          { id: "02-b", slug: "b" },
        ],
        depGraph: [
          ["03-c", "02-b"],
          ["02-b", "01-a"],
        ],
      },
    }
    expect(skeletonsAgree([planA, planB])).toBe(true)
  })

  it("three-way agreement under thorough mode", () => {
    const specD: SpecialistVerdict = {
      stage: "spec",
      skeleton: { sectionOutline: ["auth", "profiles"], riskList: ["latency", "security"] },
    }
    expect(skeletonsAgree([specA, specB, specD])).toBe(true)
  })

  it("three-way disagreement when one differs", () => {
    expect(skeletonsAgree([specA, specB, specC])).toBe(false)
  })
})
