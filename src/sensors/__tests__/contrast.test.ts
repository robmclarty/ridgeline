import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import contrastSensor from "../contrast"

describe("contrast sensor", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-contrast-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("has name 'contrast'", () => {
    expect(contrastSensor.name).toBe("contrast")
  })

  it("returns findings for explicit pairs", async () => {
    const findings = await contrastSensor.run({
      cwd: tmpDir,
      contrastPairs: [
        { name: "body-on-bg", background: "#0B0F14", foreground: "#E5E7EB" },
        { name: "fails", background: "#0B0F14", foreground: "#1F2937" },
      ],
    })
    expect(findings).toHaveLength(2)
    expect(findings[0].severity).toBe("info")
    expect(findings[0].summary).toContain("body-on-bg")
    expect(findings[0].summary).toMatch(/\d+\.\d+:1/)
    expect(findings[1].severity).toBe("error")
    expect(findings[1].summary).toContain("below WCAG AA")
  })

  it("returns no findings when no design.md or pairs are present", async () => {
    const findings = await contrastSensor.run({ cwd: tmpDir })
    expect(findings).toEqual([])
  })

  it("discovers pairs from .ridgeline/design.md when contrastPairs is absent", async () => {
    const ridgelineDir = path.join(tmpDir, ".ridgeline")
    fs.mkdirSync(ridgelineDir)
    fs.writeFileSync(
      path.join(ridgelineDir, "design.md"),
      "# Design\n\n- text on bg: #E5E7EB on #0B0F14\n- dim on bg: #9CA3AF on #0B0F14\n",
    )
    const findings = await contrastSensor.run({ cwd: tmpDir })
    expect(findings.length).toBeGreaterThanOrEqual(2)
    expect(findings.every((f) => f.kind === "contrast")).toBe(true)
  })

  it("marks invalid hex as a warning without throwing", async () => {
    const findings = await contrastSensor.run({
      cwd: tmpDir,
      contrastPairs: [{ background: "not-a-hex", foreground: "#000000" }],
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("warning")
    expect(findings[0].summary).toContain("invalid hex pair")
  })
})
