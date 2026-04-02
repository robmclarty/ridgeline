import { RidgelineConfig } from "../types"
import { logInfo, logError } from "../logging"
import { loadState } from "../state/stateManager"
import { scanPhases } from "../runner/planInvoker"
import { runBuild } from "./run"

export const runResume = async (config: RidgelineConfig): Promise<void> => {
  const state = loadState(config.buildDir)
  if (!state) {
    logError(`No state found for build '${config.buildName}'. Run 'ridgeline run ${config.buildName}' instead.`)
    process.exit(1)
  }

  const phases = scanPhases(config.phasesDir)
  if (phases.length === 0) {
    logError(`No phase files found for build '${config.buildName}'.`)
    process.exit(1)
  }

  const completedCount = state.phases.filter((p) => p.status === "complete").length
  logInfo(`Resuming build '${config.buildName}' from phase ${completedCount + 1}/${state.phases.length}`)

  // Delegate to run, which skips completed phases
  await runBuild(config)
}
