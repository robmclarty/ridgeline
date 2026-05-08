import { compose, step, type Step } from "fascicle"
import type { EnsembleResult } from "../../types.js"

export type SpecFlowInput = {
  readonly shapeMd: string
  readonly buildDir: string
  readonly buildName: string
}

export type SpecFlowOutput = {
  readonly ensemble: EnsembleResult
}

export type SpecExecutor = (input: SpecFlowInput) => Promise<EnsembleResult>

export type SpecFlowDeps = {
  readonly executor: SpecExecutor
}

export const specFlow = (deps: SpecFlowDeps): Step<SpecFlowInput, SpecFlowOutput> => {
  const inner = step("spec.inner", async (input: SpecFlowInput): Promise<SpecFlowOutput> => {
    const ensemble = await deps.executor(input)
    return { ensemble }
  })
  return compose("spec", inner)
}
