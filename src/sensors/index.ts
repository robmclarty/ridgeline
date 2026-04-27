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

export interface Viewport {
  width: number
  height: number
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
  /** Label used to name the screenshot file (e.g., `default`, `zoomed-in`). */
  viewLabel?: string
  /** Override viewport dimensions for the captured page. */
  viewport?: Viewport
  /** CSS zoom factor applied to document.body before capture. 1 = default. */
  zoom?: number
}

export interface SensorAdapter {
  readonly name: SensorName
  run(input: SensorInput): Promise<SensorFinding[]>
}

