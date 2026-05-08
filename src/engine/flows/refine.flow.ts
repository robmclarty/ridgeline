import { compose, step, type Step } from "fascicle"
import type { ClaudeResult } from "../../types.js"

export type RefineFlowInput = {
  readonly specMd: string
  readonly researchMd: string
  readonly constraintsMd: string
  readonly tasteMd: string | null
  readonly model: string
  readonly timeoutMinutes: number
  readonly buildDir: string
  readonly changelogMd: string | null
  readonly iterationNumber: number
}

export type RefineFlowOutput = {
  readonly result: ClaudeResult
}

export type RefineExecutor = (input: RefineFlowInput) => Promise<ClaudeResult>

export type RefineFlowDeps = {
  readonly executor: RefineExecutor
}

export const refineFlow = (deps: RefineFlowDeps): Step<RefineFlowInput, RefineFlowOutput> => {
  const inner = step("refine.inner", async (input: RefineFlowInput): Promise<RefineFlowOutput> => {
    const result = await deps.executor(input)
    return { result }
  })
  return compose("refine", inner)
}
