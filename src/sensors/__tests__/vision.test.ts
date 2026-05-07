import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import visionSensor, { runVisionSensor } from "../vision.js"

describe("vision sensor", () => {
  let tmpDir: string
  let screenshotPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-vision-"))
    screenshotPath = path.join(tmpDir, "shot.png")
    fs.writeFileSync(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("has name 'vision'", () => {
    expect(visionSensor.name).toBe("vision")
  })

  it("emits install-hint warning when playwright is unresolvable", async () => {
    const findings = await runVisionSensor(
      { cwd: tmpDir, screenshotPath },
      { isResolvable: () => false },
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe("vision")
    expect(findings[0].severity).toBe("warning")
    expect(findings[0].summary).toContain("npm install --save-dev playwright && npx playwright install chromium")
  })

  it("emits warning when no screenshot path provided", async () => {
    const findings = await runVisionSensor(
      { cwd: tmpDir },
      { isResolvable: () => true },
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("warning")
    expect(findings[0].summary).toContain("no screenshot path")
  })

  it("emits warning when screenshot file is missing", async () => {
    const findings = await runVisionSensor(
      { cwd: tmpDir, screenshotPath: "/nonexistent/path.png" },
      { isResolvable: () => true, existsSync: () => false },
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("warning")
    expect(findings[0].summary).toContain("screenshot not found")
  })

  it("routes the screenshot path through the supplied claude-cli stub and returns an info finding", async () => {
    const calls: Array<{ systemPrompt: string; userPrompt: string; model: string; cwd: string; imagePath: string }> = []
    const findings = await runVisionSensor(
      { cwd: tmpDir, screenshotPath, model: "sonnet-test" },
      {
        isResolvable: () => true,
        invokeVision: async (args) => {
          calls.push(args)
          return { result: "- dark background\n- two panels visible\n- status pill present" }
        },
      },
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].imagePath).toBe(screenshotPath)
    expect(calls[0].model).toBe("sonnet-test")
    expect(calls[0].userPrompt).toContain(screenshotPath)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("info")
    expect(findings[0].path).toBe(screenshotPath)
    expect(findings[0].summary).toContain("two panels visible")
  })

  it("maps claude invocation errors to warning-severity findings", async () => {
    const findings = await runVisionSensor(
      { cwd: tmpDir, screenshotPath },
      {
        isResolvable: () => true,
        invokeVision: async () => {
          throw new Error("claude timeout")
        },
      },
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("warning")
    expect(findings[0].summary).toContain("vision analysis failed")
    expect(findings[0].summary).toContain("claude timeout")
  })
})
