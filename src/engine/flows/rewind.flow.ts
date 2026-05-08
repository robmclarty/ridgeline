import { compose, step, type Step } from "fascicle"
import type { PipelineStage } from "../../types.js"

export type RewindFlowInput = {
  readonly buildName: string
  readonly stage: PipelineStage
}

export type RewindFlowOutput = {
  readonly buildName: string
  readonly stage: PipelineStage
}

export const rewindFlow = (): Step<RewindFlowInput, RewindFlowOutput> => {
  const inner = step("rewind.inner", (input: RewindFlowInput): RewindFlowOutput => {
    return { buildName: input.buildName, stage: input.stage }
  })
  return compose("rewind", inner)
}
