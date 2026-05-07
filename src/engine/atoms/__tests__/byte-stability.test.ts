import { describe, it, expect } from "vitest"
import builderFixture from "./__fixtures__/byte-stability.builder.json"
import reviewerFixture from "./__fixtures__/byte-stability.reviewer.json"
import plannerFixture from "./__fixtures__/byte-stability.planner.json"
import refinerFixture from "./__fixtures__/byte-stability.refiner.json"
import researcherFixture from "./__fixtures__/byte-stability.researcher.json"
import { shapeBuilderModelCallInput, type BuilderArgs } from "../builder.atom"
import { shapeReviewerModelCallInput, type ReviewerArgs } from "../reviewer.atom"
import { shapePlannerModelCallInput, type PlannerArgs } from "../planner.atom"
import { shapeRefinerModelCallInput, type RefinerArgs } from "../refiner.atom"
import { shapeResearcherModelCallInput, type ResearcherArgs } from "../researcher.atom"

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
})
