import { describe, it, expect } from "vitest"
import * as atoms from "../index.js"
import { stubEngine } from "./_stub.engine.js"

const ATOM_FACTORIES = [
  "builderAtom",
  "reviewerAtom",
  "plannerAtom",
  "refinerAtom",
  "researcherAtom",
  "specialistAtom",
  "specifierAtom",
  "sensorsCollectAtom",
  "planReviewAtom",
  "specialistVerdictAtom",
] as const

describe("src/engine/atoms barrel", () => {
  it("re-exports all ten atom factories", () => {
    for (const name of ATOM_FACTORIES) {
      expect(typeof (atoms as Record<string, unknown>)[name]).toBe("function")
    }
  })

  it("each factory yields a non-null Step instance", () => {
    const engine = stubEngine()
    const baseDeps = { engine, model: "opus", roleSystem: "sys" } as const

    const steps = [
      atoms.builderAtom(baseDeps),
      atoms.reviewerAtom(baseDeps),
      atoms.plannerAtom(baseDeps),
      atoms.refinerAtom(baseDeps),
      atoms.researcherAtom(baseDeps),
      atoms.specialistAtom(baseDeps),
      atoms.specifierAtom(baseDeps),
      atoms.sensorsCollectAtom(),
      atoms.planReviewAtom(baseDeps),
      atoms.specialistVerdictAtom(baseDeps),
    ]
    for (const s of steps) {
      expect(s).not.toBeNull()
      expect(typeof s.run).toBe("function")
    }
  })
})
