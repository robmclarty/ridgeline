import { compose, step, type Step } from "fascicle"

export type AutoStageOutcome = "ran" | "skipped" | "halted"

export type AutoFlowInput = {
  readonly buildName: string
  readonly buildDir: string
}

export type AutoFlowOutput = {
  readonly stages: ReadonlyArray<{ readonly name: string; readonly outcome: AutoStageOutcome }>
  readonly halted: boolean
}

export type AutoStage = {
  readonly name: string
  readonly run: () => Promise<AutoStageOutcome>
}

export type AutoFlowDeps = {
  readonly stages: () => AsyncIterable<AutoStage> | Iterable<AutoStage>
}

export const autoFlow = (deps: AutoFlowDeps): Step<AutoFlowInput, AutoFlowOutput> => {
  const inner = step<AutoFlowInput, AutoFlowOutput>("auto.inner", async (_input, ctx) => {
    const stages: { name: string; outcome: AutoStageOutcome }[] = []
    let halted = false
    for await (const stage of deps.stages()) {
      ctx.emit({ auto_event: "stage_start", stage: stage.name })
      const outcome = await stage.run()
      stages.push({ name: stage.name, outcome })
      ctx.emit({ auto_event: "stage_end", stage: stage.name, outcome })
      if (outcome === "halted") {
        halted = true
        break
      }
    }
    return { stages, halted }
  })
  return compose("auto", inner)
}
