export const printInfo = (msg: string): void => {
  console.log(`[ridgeline] ${msg}`)
}

export const printError = (msg: string): void => {
  console.error(`[ridgeline] ERROR: ${msg}`)
}

export const printPhase = (phaseId: string, msg: string): void => {
  console.log(`[ridgeline] [${phaseId}] ${msg}`)
}
