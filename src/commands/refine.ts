import * as fs from "node:fs"
import * as path from "node:path"
import { printInfo, printError } from "../ui/output"
import { invokeRefiner, RefineConfig } from "../engine/pipeline/refine.exec"
import { advancePipeline } from "../stores/state"
import { logTrajectory, makeTrajectoryEntry } from "../stores/trajectory"
import { recordCost } from "../stores/budget"

type RefineOptions = {
  model: string
  timeout: number
  flavour?: string
}

export const runRefine = async (buildName: string, opts: RefineOptions): Promise<void> => {
  const buildDir = path.join(process.cwd(), ".ridgeline", "builds", buildName)

  if (!fs.existsSync(buildDir)) {
    printError(`Build directory not found: ${buildDir}`)
    return
  }

  const specPath = path.join(buildDir, "spec.md")
  const researchPath = path.join(buildDir, "research.md")
  const constraintsPath = path.join(buildDir, "constraints.md")

  if (!fs.existsSync(specPath)) {
    printError(`spec.md not found. Run 'ridgeline spec ${buildName}' first.`)
    return
  }
  if (!fs.existsSync(researchPath)) {
    printError(`research.md not found. Run 'ridgeline research ${buildName}' first.`)
    return
  }
  if (!fs.existsSync(constraintsPath)) {
    printError(`constraints.md not found. Run 'ridgeline spec ${buildName}' first.`)
    return
  }

  const specMd = fs.readFileSync(specPath, "utf-8")
  const researchMd = fs.readFileSync(researchPath, "utf-8")
  const constraintsMd = fs.readFileSync(constraintsPath, "utf-8")
  const tastePath = path.join(buildDir, "taste.md")
  const tasteMd = fs.existsSync(tastePath) ? fs.readFileSync(tastePath, "utf-8") : null

  const config: RefineConfig = {
    model: opts.model,
    timeoutMinutes: opts.timeout,
    buildDir,
    flavour: opts.flavour ?? null,
  }

  logTrajectory(buildDir, makeTrajectoryEntry("refine_start", null, "Refine started"))

  const result = await invokeRefiner(specMd, researchMd, constraintsMd, tasteMd, config)

  recordCost(buildDir, "refine", "refiner", 0, result)

  logTrajectory(buildDir, makeTrajectoryEntry("refine_complete", null, "Refine complete", {
    duration: result.durationMs,
    tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens },
    costUsd: result.costUsd,
  }))

  advancePipeline(buildDir, buildName, "refine")

  printInfo(`\nSpec refined with research findings.`)
  printInfo(`Cost: $${result.costUsd.toFixed(2)}`)
  console.log("")
  printInfo(`Review: ${path.join(buildDir, "spec.md")}`)
  printInfo(`Next: ridgeline plan ${buildName}`)
}
