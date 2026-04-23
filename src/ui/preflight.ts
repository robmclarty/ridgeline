import * as readline from "node:readline"
import type { DetectionReport, SensorName } from "../engine/detect"
import { bold, dimInfo, hint } from "./color"

export interface PreflightOptions {
  yes: boolean
  isTTY: boolean
  stream?: NodeJS.WriteStream
  input?: NodeJS.ReadableStream
}

const SENSOR_DISPLAY: Record<SensorName, string> = {
  playwright: "Playwright",
  vision: "vision",
  a11y: "pa11y",
  contrast: "contrast",
}

const formatDetected = (report: DetectionReport): string => {
  const parts: string[] = []
  for (const dep of report.detectedDeps) parts.push(dep)
  if (report.hasDesignMd) parts.push("design.md")
  if (report.hasAssetDir) parts.push("assets")
  return parts.length > 0 ? parts.join(", ") : "no project signals"
}

const formatEnabling = (report: DetectionReport): string => {
  if (report.suggestedSensors.length === 0) return "no sensors"
  return report.suggestedSensors.map((s) => SENSOR_DISPLAY[s]).join(", ")
}

export const renderPreflight = (
  report: DetectionReport,
  opts: { isTTY: boolean; yes: boolean; isStderrTTY?: boolean },
): string => {
  const stream: "stdout" | "stderr" = "stdout"
  const detected = formatDetected(report)
  const enabling = formatEnabling(report)
  const ensembleSize = report.suggestedEnsembleSize
  const ensembleHint = ensembleSize === 2 ? "   (use --thorough for 3)" : ""

  const lines: string[] = []

  // Block 1: detection
  lines.push(
    [
      bold("Detected", { stream }),
      "   ",
      hint(detected, { stream }),
      "   ",
      dimInfo("→", { stream }),
      "   ",
      bold("enabling", { stream }),
      "   ",
      hint(enabling, { stream }),
    ].join(""),
  )

  // Blank separator
  lines.push("")

  // Block 2: ensemble + caching (labels padded so values align at column 11)
  const ensembleLine = [
    bold("Ensemble", { stream }),
    "   ",
    hint(`${ensembleSize} specialists`, { stream }),
  ]
  if (ensembleHint) ensembleLine.push(hint(ensembleHint, { stream }))
  lines.push(ensembleLine.join(""))

  lines.push(
    [
      bold("Caching", { stream }),
      "    ",
      hint("on", { stream }),
    ].join(""),
  )

  if (!opts.isTTY) {
    lines.push(hint("(auto-proceeding in CI)", { stream }))
  } else if (!opts.yes) {
    lines.push(hint("  Press Enter to continue, Ctrl+C to abort", { stream }))
  }

  return lines.join("\n") + "\n"
}

const waitForEnter = (input: NodeJS.ReadableStream): Promise<void> =>
  new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input, terminal: false })
    rl.once("line", () => {
      rl.close()
      resolve()
    })
    rl.once("close", () => resolve())
  })

export const runPreflight = async (
  report: DetectionReport,
  opts: PreflightOptions,
): Promise<void> => {
  const stream = opts.stream ?? process.stdout
  const rendered = renderPreflight(report, { isTTY: opts.isTTY, yes: opts.yes })
  stream.write(rendered)

  if (!opts.isTTY) return
  if (opts.yes) return

  const input = opts.input ?? process.stdin
  await waitForEnter(input)
}
