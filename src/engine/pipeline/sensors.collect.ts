import type { SensorName } from "../detect"
import type { SensorAdapter, SensorFinding, SensorInput } from "../../sensors"
import playwrightSensor from "../../sensors/playwright"
import visionSensor from "../../sensors/vision"
import a11ySensor from "../../sensors/a11y"
import contrastSensor from "../../sensors/contrast"

export const SENSOR_REGISTRY: Record<SensorName, SensorAdapter> = {
  playwright: playwrightSensor,
  vision: visionSensor,
  a11y: a11ySensor,
  contrast: contrastSensor,
}

export const collectSensorFindings = async (
  names: readonly SensorName[],
  input: SensorInput,
  options: { onWarn?: (line: string) => void } = {},
): Promise<SensorFinding[]> => {
  const onWarn = options.onWarn ?? ((line: string) => process.stderr.write(`${line}\n`))
  const findings: SensorFinding[] = []

  for (const name of names) {
    const adapter = SENSOR_REGISTRY[name]
    try {
      const results = await adapter.run(input)
      findings.push(...results)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      onWarn(`[ridgeline] WARN: sensor ${name} failed: ${message}`)
    }
  }

  return findings
}
