import { describe, it, expect } from "vitest"
import { run } from "fascicle"
import type { SensorAdapter, SensorFinding, SensorInput } from "../../../sensors/index.js"
import type { SensorName } from "../../project-type.js"
import { sensorsCollectAtom, type SensorsCollectArgs } from "../sensors.collect.atom.js"

const makeStubAdapter = (
  name: SensorName,
  fn: (input: SensorInput) => Promise<SensorFinding[]>,
): SensorAdapter => ({ name, run: fn })

const stubInput: SensorInput = { cwd: "/tmp/cwd" }

describe("sensorsCollectAtom", () => {
  it("collects findings from each named sensor in order", async () => {
    const calls: SensorName[] = []
    const registry: Record<SensorName, SensorAdapter> = {
      playwright: makeStubAdapter("playwright", async () => {
        calls.push("playwright")
        return [{ kind: "screenshot", summary: "ok", severity: "info" }]
      }),
      vision: makeStubAdapter("vision", async () => {
        calls.push("vision")
        return [{ kind: "vision", summary: "described", severity: "info" }]
      }),
      a11y: makeStubAdapter("a11y", async () => {
        calls.push("a11y")
        return []
      }),
      contrast: makeStubAdapter("contrast", async () => {
        calls.push("contrast")
        return []
      }),
    }
    const atom = sensorsCollectAtom({ registry })
    const args: SensorsCollectArgs = { names: ["playwright", "vision"], input: stubInput }
    const findings = await run(atom, args, { install_signal_handlers: false })
    expect(calls).toEqual(["playwright", "vision"])
    expect(findings).toHaveLength(2)
    expect(findings[0].kind).toBe("screenshot")
    expect(findings[1].kind).toBe("vision")
  })

  it("warns and continues when a sensor throws", async () => {
    const warnings: string[] = []
    const registry: Record<SensorName, SensorAdapter> = {
      playwright: makeStubAdapter("playwright", async () => {
        throw new Error("browser unavailable")
      }),
      vision: makeStubAdapter("vision", async () => [
        { kind: "vision", summary: "ok", severity: "info" },
      ]),
      a11y: makeStubAdapter("a11y", async () => []),
      contrast: makeStubAdapter("contrast", async () => []),
    }
    const atom = sensorsCollectAtom({
      registry,
      onWarn: (line) => warnings.push(line),
    })
    const args: SensorsCollectArgs = { names: ["playwright", "vision"], input: stubInput }
    const findings = await run(atom, args, { install_signal_handlers: false })
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe("vision")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("sensor playwright failed: browser unavailable")
  })
})
