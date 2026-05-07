import { describe, expect, it, vi } from "vitest"
import { SENSOR_REGISTRY, collectSensorFindings } from "../../engine/sensors-collect.js"
import type { SensorAdapter, SensorFinding } from "../index.js"

describe("SENSOR_REGISTRY", () => {
  it("declares all four sensors unconditionally", () => {
    expect(Object.keys(SENSOR_REGISTRY).sort()).toEqual(["a11y", "contrast", "playwright", "vision"])
  })

  it("exposes an adapter with name + run for each entry", () => {
    for (const [name, adapter] of Object.entries(SENSOR_REGISTRY)) {
      expect(adapter.name).toBe(name)
      expect(typeof adapter.run).toBe("function")
    }
  })
})

describe("collectSensorFindings", () => {
  const stubAdapter = (name: string, findings: SensorFinding[] | (() => Promise<never>)): SensorAdapter =>
    ({
      name: name as SensorAdapter["name"],
      run: typeof findings === "function" ? findings : async () => findings,
    })

  it("runs each sensor in order and flattens findings", async () => {
    const order: string[] = []
    vi.spyOn(SENSOR_REGISTRY, "playwright", "get").mockReturnValue(
      stubAdapter("playwright", [
        { kind: "screenshot", severity: "info", summary: "a" },
      ]),
    )
    const findings = await collectSensorFindings(["playwright"], { cwd: "/tmp" }, {
      onWarn: () => order.push("warned"),
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].summary).toBe("a")
    vi.restoreAllMocks()
  })

  it("treats a sensor that rejects as non-fatal and continues", async () => {
    const warnings: string[] = []
    const rejecting = stubAdapter("contrast", async () => {
      throw new Error("boom")
    })
    const healthy = stubAdapter("playwright", [
      { kind: "screenshot", severity: "info", summary: "ok" },
    ])
    vi.spyOn(SENSOR_REGISTRY, "contrast", "get").mockReturnValue(rejecting)
    vi.spyOn(SENSOR_REGISTRY, "playwright", "get").mockReturnValue(healthy)

    const findings = await collectSensorFindings(["contrast", "playwright"], { cwd: "/tmp" }, {
      onWarn: (line) => warnings.push(line),
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].summary).toBe("ok")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("sensor contrast failed")
    expect(warnings[0]).toContain("boom")
    vi.restoreAllMocks()
  })
})
