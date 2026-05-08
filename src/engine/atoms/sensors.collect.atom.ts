import { compose, step, type Step } from "fascicle"
import type { SensorName } from "../project-type.js"
import type { SensorAdapter, SensorFinding, SensorInput } from "../../sensors/index.js"
import playwrightSensor from "../../sensors/playwright.js"
import visionSensor from "../../sensors/vision.js"
import a11ySensor from "../../sensors/a11y.js"
import contrastSensor from "../../sensors/contrast.js"

const defaultRegistry: Record<SensorName, SensorAdapter> = {
  playwright: playwrightSensor,
  vision: visionSensor,
  a11y: a11ySensor,
  contrast: contrastSensor,
}

export type SensorsCollectArgs = {
  readonly names: ReadonlyArray<SensorName>
  readonly input: SensorInput
}

export type SensorsCollectAtomDeps = {
  readonly registry?: Record<SensorName, SensorAdapter>
  readonly onWarn?: (line: string) => void
}

const runSensors = async (
  args: SensorsCollectArgs,
  deps: SensorsCollectAtomDeps,
): Promise<ReadonlyArray<SensorFinding>> => {
  const registry = deps.registry ?? defaultRegistry
  const onWarn = deps.onWarn ?? (() => {})
  const findings: SensorFinding[] = []
  for (const name of args.names) {
    const adapter = registry[name]
    try {
      const results = await adapter.run(args.input)
      findings.push(...results)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      onWarn(`[ridgeline] WARN: sensor ${name} failed: ${message}`)
    }
  }
  return findings
}

export const sensorsCollectAtom = (
  deps: SensorsCollectAtomDeps = {},
): Step<SensorsCollectArgs, ReadonlyArray<SensorFinding>> => {
  const inner = step("sensors.collect.run", async (args: SensorsCollectArgs) =>
    runSensors(args, deps),
  )
  return compose("sensors.collect", inner)
}
