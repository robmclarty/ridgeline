import * as fs from "node:fs"
import * as path from "node:path"
import { printInfo, printError } from "../ui/output.js"
import { rewindTo, getPipelineStatus } from "../stores/state.js"
import { PipelineStage } from "../types.js"

const VALID_STAGES: PipelineStage[] = ["shape", "design", "spec", "research", "refine", "plan"]

export const runRewind = (buildName: string, to: string): void => {
  if (!VALID_STAGES.includes(to as PipelineStage)) {
    printError(`Invalid stage: ${to}. Must be one of: ${VALID_STAGES.join(", ")}`)
    return
  }

  const targetStage = to as PipelineStage
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = path.join(ridgelineDir, "builds", buildName)

  if (!fs.existsSync(buildDir)) {
    printError(`Build directory not found: ${buildDir}`)
    return
  }

  printInfo(`Rewinding build "${buildName}" to: ${targetStage}`)

  const filesToDelete = rewindTo(buildDir, buildName, targetStage)

  // Delete downstream files
  for (const fp of filesToDelete) {
    try {
      fs.unlinkSync(fp)
    } catch {
      // File may already be gone
    }
  }

  const statusAfter = getPipelineStatus(buildDir)

  if (filesToDelete.length > 0) {
    printInfo(`Removed ${filesToDelete.length} file(s)`)
  }

  console.log("")
  const ALL_DISPLAY_STAGES: PipelineStage[] = ["shape", "design", "spec", "research", "refine", "plan", "build"]
  for (const stage of ALL_DISPLAY_STAGES) {
    const status = statusAfter[stage]
    const icon = status === "complete" ? "done" : status === "skipped" ? "skip" : "---"
    console.log(`  ${stage.padEnd(16)} ${icon}`)
  }

  console.log("")
  printInfo(`Next: ridgeline ${buildName}`)
}
