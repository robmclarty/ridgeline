export const logInfo = (msg: string): void => {
  console.log(`[ridgeline] ${msg}`)
}

export const logError = (msg: string): void => {
  console.error(`[ridgeline] ERROR: ${msg}`)
}

export const logPhase = (phaseId: string, msg: string): void => {
  console.log(`[ridgeline] [${phaseId}] ${msg}`)
}
