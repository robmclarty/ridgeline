import * as readline from "node:readline"
import type { DetectionReport, SensorName } from "../engine/project-type.js"
import { bold, dimInfo, hint, warning } from "./color.js"
import { minCacheableTokens } from "../engine/claude/stable.prompt.js"

export interface StablePromptInfo {
  tokens: number
  model: string
}

export interface PreflightOptions {
  yes: boolean
  isTTY: boolean
  stream?: NodeJS.WritableStream
  input?: NodeJS.ReadableStream
  isPlaywrightResolvable?: () => boolean
  stablePromptInfo?: StablePromptInfo
}

const PLAYWRIGHT_INSTALL_HINT =
  "npm install --save-dev playwright && npx playwright install chromium"

const defaultIsPlaywrightResolvable = (): boolean => {
  try {
    require.resolve("playwright")
    return true
  } catch {
    return false
  }
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
  if (report.visualFileExts.length > 0) {
    parts.push(`${report.visualFileExts.join("/")} files`)
  }
  return parts.length > 0 ? parts.join(", ") : "no project signals"
}

const formatEnabling = (report: DetectionReport): string => {
  if (report.suggestedSensors.length === 0) return "no sensors"
  return report.suggestedSensors.map((s) => SENSOR_DISPLAY[s]).join(", ")
}

export const renderPreflight = (
  report: DetectionReport,
  opts: {
    isTTY: boolean
    yes: boolean
    isStderrTTY?: boolean
    isPlaywrightResolvable?: () => boolean
    stablePromptInfo?: StablePromptInfo
  },
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

  const resolver = opts.isPlaywrightResolvable ?? defaultIsPlaywrightResolvable
  if (report.isVisualSurface && !resolver()) {
    lines.push("")
    lines.push(
      [
        warning("Playwright not installed", { stream }),
        hint(" — visual surface detected; install with: ", { stream }),
        PLAYWRIGHT_INSTALL_HINT,
      ].join(""),
    )
  }

  if (opts.stablePromptInfo) {
    const threshold = minCacheableTokens(opts.stablePromptInfo.model)
    if (opts.stablePromptInfo.tokens < threshold) {
      lines.push("")
      lines.push(
        [
          warning("Caching skipped", { stream }),
          hint(
            ` — stable prompt ~${opts.stablePromptInfo.tokens} tokens under ${threshold}-token minimum; upstream will skip the cache`,
            { stream },
          ),
        ].join(""),
      )
    }
  }

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
  const rendered = renderPreflight(report, {
    isTTY: opts.isTTY,
    yes: opts.yes,
    isPlaywrightResolvable: opts.isPlaywrightResolvable,
    stablePromptInfo: opts.stablePromptInfo,
  })
  stream.write(rendered)

  if (!opts.isTTY) return
  if (opts.yes) return

  const input = opts.input ?? process.stdin
  await waitForEnter(input)
}
