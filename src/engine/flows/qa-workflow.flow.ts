import { compose, step, type Step } from "fascicle"
import type { ClaudeResult } from "../../types.js"

export type QAWorkflowFlowInput = {
  readonly systemPrompt: string
  readonly userPrompt: string
  readonly model: string
  readonly timeoutMs: number
  readonly allowedTools?: ReadonlyArray<string>
  readonly jsonSchema?: string
  readonly buildDir?: string
  readonly sessionId?: string
}

export type QAWorkflowFlowOutput = {
  readonly result: ClaudeResult
}

export type QAWorkflowExecutor = (input: QAWorkflowFlowInput) => Promise<ClaudeResult>

export type QAWorkflowFlowDeps = {
  readonly executor: QAWorkflowExecutor
}

export const qaWorkflowFlow = (
  deps: QAWorkflowFlowDeps,
): Step<QAWorkflowFlowInput, QAWorkflowFlowOutput> => {
  const inner = step("qa-workflow.inner", async (input: QAWorkflowFlowInput): Promise<QAWorkflowFlowOutput> => {
    const result = await deps.executor(input)
    return { result }
  })
  return compose("qa-workflow", inner)
}
