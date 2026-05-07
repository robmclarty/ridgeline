import { compose, step, type Step } from "fascicle"
import type { EnsembleResult } from "../../types.js"

export type ResearchFlowInput = {
  readonly specMd: string
  readonly constraintsMd: string
  readonly tasteMd: string | null
  readonly buildDir: string
  readonly buildName: string
  readonly iterationNumber: number
  readonly isQuick: boolean
}

export type ResearchFlowOutput = {
  readonly ensemble: EnsembleResult
}

export type ResearchExecutor = (input: ResearchFlowInput) => Promise<EnsembleResult>

export type ResearchFlowDeps = {
  readonly executor: ResearchExecutor
}

export const researchFlow = (deps: ResearchFlowDeps): Step<ResearchFlowInput, ResearchFlowOutput> => {
  const inner = step("research.inner", async (input: ResearchFlowInput): Promise<ResearchFlowOutput> => {
    const ensemble = await deps.executor(input)
    return { ensemble }
  })
  return compose("research", inner)
}
