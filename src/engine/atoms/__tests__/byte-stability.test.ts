import { describe, it, expect } from "vitest"
import builderFixture from "./__fixtures__/byte-stability.builder.json" with { type: "json" }
import reviewerFixture from "./__fixtures__/byte-stability.reviewer.json" with { type: "json" }
import plannerFixture from "./__fixtures__/byte-stability.planner.json" with { type: "json" }
import refinerFixture from "./__fixtures__/byte-stability.refiner.json" with { type: "json" }
import researcherFixture from "./__fixtures__/byte-stability.researcher.json" with { type: "json" }
import specialistFixture from "./__fixtures__/byte-stability.specialist.json" with { type: "json" }
import specifierFixture from "./__fixtures__/byte-stability.specifier.json" with { type: "json" }
import specialistVerdictFixture from "./__fixtures__/byte-stability.specialist.verdict.json" with { type: "json" }
import planReviewFixture from "./__fixtures__/byte-stability.plan.review.json" with { type: "json" }
import { shapeBuilderModelCallInput, type BuilderArgs } from "../builder.atom.js"
import { shapeReviewerModelCallInput, type ReviewerArgs } from "../reviewer.atom.js"
import { shapePlannerModelCallInput, type PlannerArgs } from "../planner.atom.js"
import { shapeRefinerModelCallInput, type RefinerArgs } from "../refiner.atom.js"
import { shapeResearcherModelCallInput, type ResearcherArgs } from "../researcher.atom.js"
import { shapeSpecialistModelCallInput, type SpecialistArgs } from "../specialist.atom.js"
import { shapeSpecifierModelCallInput, type SpecifierArgs } from "../specifier.atom.js"
import {
  shapeSpecialistVerdictModelCallInput,
  type SpecialistVerdictArgs,
} from "../specialist.verdict.atom.js"
import { shapePlanReviewModelCallInput, type PlanReviewArgs } from "../plan.review.atom.js"

describe("atom byte-stability", () => {
  it("builder shape is byte-stable for frozen args", () => {
    const out = shapeBuilderModelCallInput(builderFixture.args as BuilderArgs)
    expect(out).toBe(builderFixture.modelCallInput)
  })

  it("reviewer shape is byte-stable for frozen args", () => {
    const out = shapeReviewerModelCallInput(reviewerFixture.args as ReviewerArgs)
    expect(out).toBe(reviewerFixture.modelCallInput)
  })

  it("planner shape is byte-stable for frozen args", () => {
    const out = shapePlannerModelCallInput(plannerFixture.args as PlannerArgs)
    expect(out).toBe(plannerFixture.modelCallInput)
  })

  it("refiner shape is byte-stable for frozen args", () => {
    const out = shapeRefinerModelCallInput(refinerFixture.args as RefinerArgs)
    expect(out).toBe(refinerFixture.modelCallInput)
  })

  it("researcher shape is byte-stable for frozen args", () => {
    const out = shapeResearcherModelCallInput(researcherFixture.args as ResearcherArgs)
    expect(out).toBe(researcherFixture.modelCallInput)
  })

  it("specialist shape is byte-stable for frozen args", () => {
    const out = shapeSpecialistModelCallInput(specialistFixture.args as SpecialistArgs)
    expect(out).toBe(specialistFixture.modelCallInput)
  })

  it("specifier shape is byte-stable for frozen args", () => {
    const out = shapeSpecifierModelCallInput(specifierFixture.args as SpecifierArgs)
    expect(out).toBe(specifierFixture.modelCallInput)
  })

  it("specialist.verdict shape is byte-stable for frozen args", () => {
    const out = shapeSpecialistVerdictModelCallInput(
      specialistVerdictFixture.args as SpecialistVerdictArgs,
    )
    expect(out).toBe(specialistVerdictFixture.modelCallInput)
  })

  it("plan.review shape is byte-stable for frozen args", () => {
    const out = shapePlanReviewModelCallInput(planReviewFixture.args as PlanReviewArgs)
    expect(out).toBe(planReviewFixture.modelCallInput)
  })
})
