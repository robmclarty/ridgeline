import { compose, step, type Step } from "fascicle"
import type { ClaudeResult } from "../../types.js"

export type RetroRefineFlowInput = {
  readonly systemPrompt: string
  readonly userPrompt: string
  readonly model: string
  readonly timeoutMs: number
}

export type RetroRefineFlowOutput = {
  readonly result: ClaudeResult
}

export type RetroRefineExecutor = (input: RetroRefineFlowInput) => Promise<ClaudeResult>

export type RetroRefineFlowDeps = {
  readonly executor: RetroRefineExecutor
}

export const retroRefineFlow = (
  deps: RetroRefineFlowDeps,
): Step<RetroRefineFlowInput, RetroRefineFlowOutput> => {
  const inner = step("retro-refine.inner", async (input: RetroRefineFlowInput): Promise<RetroRefineFlowOutput> => {
    const result = await deps.executor(input)
    return { result }
  })
  return compose("retro-refine", inner)
}
