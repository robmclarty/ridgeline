import * as fs from "node:fs"
import { makeRidgelineEngine } from "../engine/engine.factory.js"
import { runClaudeOneShot } from "../engine/claude.runner.js"
import type { SensorAdapter, SensorFinding, SensorInput } from "./index.js"

const PLAYWRIGHT_INSTALL_HINT =
  "npm install --save-dev playwright && npx playwright install chromium"

const isPlaywrightResolvable = (): boolean => {
  try {
    require.resolve("playwright")
    return true
  } catch {
    return false
  }
}

const VISION_SYSTEM_PROMPT =
  "You are a visual-analysis assistant. Describe the rendered UI at the given screenshot path: "
  + "layout, visible elements, color usage, obvious visual defects. Respond in 3-5 short bullet points. "
  + "Read the image file with the Read tool."

const VISION_TIMEOUT_MS = 2 * 60 * 1000

type InvokeVision = (args: {
  systemPrompt: string
  userPrompt: string
  model: string
  cwd: string
  imagePath: string
}) => Promise<{ result: string }>

const defaultInvokeVision: InvokeVision = async (args) => {
  const engine = makeRidgelineEngine({
    sandboxFlag: "off",
    timeoutMinutes: Math.ceil(VISION_TIMEOUT_MS / 60_000),
    pluginDirs: [],
    settingSources: ["user", "project", "local"],
    buildPath: args.cwd,
  })
  try {
    const result = await runClaudeOneShot({
      engine,
      model: args.model,
      system: args.systemPrompt,
      prompt: args.userPrompt,
      allowedTools: ["Read"],
    })
    return { result: result.result }
  } finally {
    await engine.dispose()
  }
}

const unresolvableFinding = (): SensorFinding => ({
  kind: "vision",
  severity: "warning",
  summary: `Playwright is not installed. Install with: ${PLAYWRIGHT_INSTALL_HINT}`,
})

interface VisionRunInternals {
  invokeVision?: InvokeVision
  existsSync?: (p: string) => boolean
  isResolvable?: () => boolean
}

export const runVisionSensor = async (
  input: SensorInput,
  internals: VisionRunInternals = {},
): Promise<SensorFinding[]> => {
  const resolvable = (internals.isResolvable ?? isPlaywrightResolvable)()
  if (!resolvable) {
    return [unresolvableFinding()]
  }

  const imagePath = input.screenshotPath
  const exists = internals.existsSync ?? fs.existsSync
  if (!imagePath || !exists(imagePath)) {
    return [
      {
        kind: "vision",
        severity: "warning",
        summary: imagePath
          ? `screenshot not found at ${imagePath}`
          : "no screenshot path provided for vision analysis",
      },
    ]
  }

  const invoke = internals.invokeVision ?? defaultInvokeVision
  const model = input.model ?? "opus"
  const userPrompt = `Analyze the UI screenshot at: ${imagePath}\n\nRead the image with the Read tool, then respond with 3-5 short observations.`

  try {
    const { result } = await invoke({
      systemPrompt: VISION_SYSTEM_PROMPT,
      userPrompt,
      model,
      cwd: input.cwd,
      imagePath,
    })
    return [
      {
        kind: "vision",
        severity: "info",
        path: imagePath,
        summary: result.trim() || "(vision returned empty analysis)",
      },
    ]
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return [
      {
        kind: "vision",
        severity: "warning",
        path: imagePath,
        summary: `vision analysis failed: ${message}`,
      },
    ]
  }
}

const visionSensor: SensorAdapter = {
  name: "vision",
  run: (input: SensorInput): Promise<SensorFinding[]> => runVisionSensor(input),
}

export default visionSensor
