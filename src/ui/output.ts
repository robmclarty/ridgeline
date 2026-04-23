import { log } from "./logger"
import { appendTranscript } from "./transcript"
import { error, warning } from "./color"

export const printInfo = (msg: string): void => {
  const line = `[ridgeline] ${msg}`
  console.log(line)
  log("info", msg)
  appendTranscript(line)
}

export const printWarn = (msg: string): void => {
  const line = `[ridgeline] ${warning("WARN:", { stream: "stderr" })} ${msg}`
  console.error(line)
  log("warn", msg)
  appendTranscript(line)
}

export const printError = (msg: string): void => {
  const line = `[ridgeline] ${error("ERROR:", { stream: "stderr" })} ${msg}`
  console.error(line)
  log("error", msg)
  appendTranscript(line)
}

export const printPhase = (phaseId: string, msg: string): void => {
  const line = `[ridgeline] [${phaseId}] ${msg}`
  console.log(line)
  log("info", msg, { phase: phaseId })
  appendTranscript(line)
}

export const printPhaseHeader = (index: number, total: number, phaseId: string): void => {
  const line = `\n[ridgeline] ${"─".repeat(2)} Phase ${index}/${total}: ${phaseId} ${"─".repeat(2)}`
  console.log(line)
  log("info", `Phase ${index}/${total}: ${phaseId}`, { phase: phaseId })
  appendTranscript(line)
}
