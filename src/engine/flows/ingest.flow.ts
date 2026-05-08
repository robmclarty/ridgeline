import { compose, step, type Step } from "fascicle"

export type IngestFlowInput = {
  readonly buildName: string
  readonly buildDir: string
}

export type IngestFlowOutput = {
  readonly buildName: string
}

export const ingestFlow = (): Step<IngestFlowInput, IngestFlowOutput> => {
  const inner = step("ingest.inner", (input: IngestFlowInput): IngestFlowOutput => {
    return { buildName: input.buildName }
  })
  return compose("ingest", inner)
}
