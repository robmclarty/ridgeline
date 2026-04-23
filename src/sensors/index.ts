import type { SensorName } from "../engine/detect"

export interface SensorFinding {
  kind: "screenshot" | "a11y" | "contrast" | "vision"
  path?: string
  summary: string
  severity: "info" | "warning" | "error"
}

export interface ColorPair {
  name?: string
  foreground: string
  background: string
}

export interface SensorInput {
  cwd: string
  ridgelineDir?: string
  buildDir?: string
  shapeMdPath?: string
  artifactsDir?: string
  model?: string
  url?: string
  screenshotPath?: string
  contrastPairs?: readonly ColorPair[]
}

export interface SensorAdapter {
  readonly name: SensorName
  run(input: SensorInput): Promise<SensorFinding[]>
}

