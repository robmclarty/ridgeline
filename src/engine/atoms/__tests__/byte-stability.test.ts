import { describe, it, expect } from "vitest"
import builderFixture from "./__fixtures__/byte-stability.builder.json"
import reviewerFixture from "./__fixtures__/byte-stability.reviewer.json"
import plannerFixture from "./__fixtures__/byte-stability.planner.json"
import refinerFixture from "./__fixtures__/byte-stability.refiner.json"
import researcherFixture from "./__fixtures__/byte-stability.researcher.json"
import specialistFixture from "./__fixtures__/byte-stability.specialist.json"
import specifierFixture from "./__fixtures__/byte-stability.specifier.json"
import specialistVerdictFixture from "./__fixtures__/byte-stability.specialist.verdict.json"
import planReviewFixture from "./__fixtures__/byte-stability.plan.review.json"
import { shapeBuilderModelCallInput, type BuilderArgs } from "../builder.atom"
import { shapeReviewerModelCallInput, type ReviewerArgs } from "../reviewer.atom"
import { shapePlannerModelCallInput, type PlannerArgs } from "../planner.atom"
import { shapeRefinerModelCallInput, type RefinerArgs } from "../refiner.atom"
import { shapeResearcherModelCallInput, type ResearcherArgs } from "../researcher.atom"
import { shapeSpecialistModelCallInput, type SpecialistArgs } from "../specialist.atom"
import { shapeSpecifierModelCallInput, type SpecifierArgs } from "../specifier.atom"
import {
  shapeSpecialistVerdictModelCallInput,
  type SpecialistVerdictArgs,
} from "../specialist.verdict.atom"
import { shapePlanReviewModelCallInput, type PlanReviewArgs } from "../plan.review.atom"

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
