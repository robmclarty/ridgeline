import { compose, step, type Step } from "fascicle"
import type { PhaseInfo } from "../../types.js"

export type DryRunFlowInput = {
  readonly phases: ReadonlyArray<PhaseInfo>
}

export type DryRunFlowOutput = {
  readonly phaseCount: number
}

export const dryRunFlow = (): Step<DryRunFlowInput, DryRunFlowOutput> => {
  const inner = step("dry-run.inner", (input: DryRunFlowInput): DryRunFlowOutput => {
    return { phaseCount: input.phases.length }
  })
  return compose("dry-run", inner)
}
