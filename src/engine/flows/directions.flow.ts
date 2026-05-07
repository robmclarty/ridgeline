import { compose, step, type Step } from "fascicle"

export type DirectionsFlowInput = {
  readonly buildName: string
  readonly buildDir: string
}

export type DirectionsFlowOutput = {
  readonly buildName: string
}

export const directionsFlow = (): Step<DirectionsFlowInput, DirectionsFlowOutput> => {
  const inner = step("directions.inner", (input: DirectionsFlowInput): DirectionsFlowOutput => {
    return { buildName: input.buildName }
  })
  return compose("directions", inner)
}
