import * as path from "node:path"
import { ClaudeResult } from "../types"

export const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return remaining > 0 ? `${minutes}m ${remaining.toString().padStart(2, "0")}s` : `${minutes}m`
}

export const formatTokens = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

type ResearchSummaryInput = {
  buildName: string
  buildDir: string
  iteration: number
  specialistNames: string[]
  specialistResults: ClaudeResult[]
  synthesizerResult: ClaudeResult
  totalCostUsd: number
}

export const printResearchSummary = (input: ResearchSummaryInput): void => {
  const {
    buildName, buildDir, iteration,
    specialistNames, specialistResults, synthesizerResult, totalCostUsd,
  } = input

  const nameColWidth = Math.max(
    20,
    ...specialistNames.map((n) => n.length),
    "Synthesizer".length,
    "Total".length,
  )
  const tableWidth = nameColWidth + 28
  const sep = "  " + "=".repeat(tableWidth)
  const div = "  " + "-".repeat(tableWidth)

  const formatRow = (name: string, duration: string, cost: string): string =>
    `  ${name.padEnd(nameColWidth)}  ${duration.padStart(8)}    ${cost.padStart(8)}`

  console.log("")
  console.log(sep)
  console.log(`  Research: ${buildName} (iteration ${iteration})`)
  console.log(sep)

  console.log("")
  console.log(formatRow("", "Duration", "Cost"))
  console.log(div)

  // Per-specialist rows
  let specialistCost = 0
  for (let i = 0; i < specialistResults.length; i++) {
    const r = specialistResults[i]
    const name = specialistNames[i] ?? `specialist-${i}`
    specialistCost += r.costUsd
    console.log(formatRow(name, formatDuration(r.durationMs), `$${r.costUsd.toFixed(2)}`))
  }
  console.log(div)

  // Specialists aggregate (wall-clock = max since they run in parallel)
  const specialistWallClock = Math.max(...specialistResults.map((r) => r.durationMs))
  console.log(formatRow(
    `Specialists (${specialistResults.length})`,
    formatDuration(specialistWallClock),
    `$${specialistCost.toFixed(2)}`,
  ))
  console.log(formatRow(
    "Synthesizer",
    formatDuration(synthesizerResult.durationMs),
    `$${synthesizerResult.costUsd.toFixed(2)}`,
  ))
  console.log(div)

  // Total
  const totalWallClock = specialistWallClock + synthesizerResult.durationMs
  console.log(formatRow("Total", formatDuration(totalWallClock), `$${totalCostUsd.toFixed(2)}`))

  // Footer
  const totalIn = specialistResults.reduce((s, r) => s + r.usage.inputTokens, 0) + synthesizerResult.usage.inputTokens
  const totalOut = specialistResults.reduce((s, r) => s + r.usage.outputTokens, 0) + synthesizerResult.usage.outputTokens
  console.log("")
  console.log(`  Tokens: ${formatTokens(totalIn)} in / ${formatTokens(totalOut)} out`)
  console.log(`  Output: ${path.join(buildDir, "research.md")}`)
}
