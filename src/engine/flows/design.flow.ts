import { compose, step, type Step } from "fascicle"

export type DesignFlowInput = {
  readonly buildName: string
  readonly buildDir: string
}

export type DesignFlowOutput = {
  readonly buildName: string
}

export const designFlow = (): Step<DesignFlowInput, DesignFlowOutput> => {
  const inner = step("design.inner", (input: DesignFlowInput): DesignFlowOutput => {
    return { buildName: input.buildName }
  })
  return compose("design", inner)
}
