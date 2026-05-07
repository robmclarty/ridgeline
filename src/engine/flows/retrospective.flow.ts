import { compose, step, type Step } from "fascicle"
import type { ClaudeResult } from "../../types.js"

export type RetrospectiveFlowInput = {
  readonly systemPrompt: string
  readonly userPrompt: string
  readonly model: string
  readonly timeoutMs: number
}

export type RetrospectiveFlowOutput = {
  readonly result: ClaudeResult
}

export type RetrospectiveExecutor = (input: RetrospectiveFlowInput) => Promise<ClaudeResult>

export type RetrospectiveFlowDeps = {
  readonly executor: RetrospectiveExecutor
}

export const retrospectiveFlow = (
  deps: RetrospectiveFlowDeps,
): Step<RetrospectiveFlowInput, RetrospectiveFlowOutput> => {
  const inner = step("retrospective.inner", async (input: RetrospectiveFlowInput): Promise<RetrospectiveFlowOutput> => {
    const result = await deps.executor(input)
    return { result }
  })
  return compose("retrospective", inner)
}
