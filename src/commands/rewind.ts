import * as fs from "node:fs"
import * as path from "node:path"
import { printInfo, printError } from "../ui/output"
import { rewindTo, getPipelineStatus } from "../store/state"
import { PipelineStage } from "../types"

const VALID_STAGES: PipelineStage[] = ["shape", "spec", "plan"]

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

  // Also clean up worktree directory if it exists
  const worktreeDir = path.join(ridgelineDir, "worktrees", buildName)
  if (fs.existsSync(worktreeDir)) {
    printInfo(`Worktree at ${worktreeDir} may need manual cleanup (use 'ridgeline clean')`)
  }

  const statusAfter = getPipelineStatus(buildDir)

  if (filesToDelete.length > 0) {
    printInfo(`Removed ${filesToDelete.length} file(s)`)
  }

  console.log("")
  for (const stage of ["shape", "spec", "plan", "build"] as PipelineStage[]) {
    const icon = statusAfter[stage] === "complete" ? "done" : "---"
    console.log(`  ${stage.padEnd(16)} ${icon}`)
  }

  console.log("")
  printInfo(`Next: ridgeline ${buildName}`)
}
