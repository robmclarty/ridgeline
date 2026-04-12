import { log } from "./logger"

export const printInfo = (msg: string): void => {
  console.log(`[ridgeline] ${msg}`)
  log("info", msg)
}

export const printWarn = (msg: string): void => {
  console.error(`[ridgeline] WARN: ${msg}`)
  log("warn", msg)
}

export const printError = (msg: string): void => {
  console.error(`[ridgeline] ERROR: ${msg}`)
  log("error", msg)
}

export const printPhase = (phaseId: string, msg: string): void => {
  console.log(`[ridgeline] [${phaseId}] ${msg}`)
  log("info", msg, { phase: phaseId })
}

export const printPhaseHeader = (index: number, total: number, phaseId: string): void => {
  console.log(`\n[ridgeline] ${"─".repeat(2)} Phase ${index}/${total}: ${phaseId} ${"─".repeat(2)}`)
  log("info", `Phase ${index}/${total}: ${phaseId}`, { phase: phaseId })
}
