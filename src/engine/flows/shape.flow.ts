import { compose, step, type Step } from "fascicle"

export type ShapeFlowInput = {
  readonly buildName: string
  readonly buildDir: string
}

export type ShapeFlowOutput = {
  readonly buildName: string
}

export const shapeFlow = (): Step<ShapeFlowInput, ShapeFlowOutput> => {
  const inner = step("shape.inner", (input: ShapeFlowInput): ShapeFlowOutput => {
    return { buildName: input.buildName }
  })
  return compose("shape", inner)
}
