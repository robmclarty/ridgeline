import * as fs from "node:fs"
import * as path from "node:path"
import { printInfo, printError } from "../ui/output"
import { invokeSpecEnsemble, SpecEnsembleConfig } from "../engine/pipeline/sketch.exec"
import { advancePipeline } from "../store/state"

export type SpecOptions = {
  model: string
  timeout: number
  maxBudgetUsd?: number
}

export const runSpec = async (buildName: string, opts: SpecOptions): Promise<void> => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = path.join(ridgelineDir, "builds", buildName)

  // Verify shape.md exists
  const shapePath = path.join(buildDir, "shape.md")
  if (!fs.existsSync(shapePath)) {
    printError(`shape.md not found at ${shapePath}`)
    printError(`Run 'ridgeline shape ${buildName}' first`)
    return
  }

  const shapeMd = fs.readFileSync(shapePath, "utf-8")

  const config: SpecEnsembleConfig = {
    model: opts.model,
    timeoutMinutes: opts.timeout,
    maxBudgetUsd: opts.maxBudgetUsd ?? null,
    buildDir,
  }

  const result = await invokeSpecEnsemble(shapeMd, config)

  // Verify output files
  console.log("")
  const createdFiles = ["spec.md", "constraints.md", "taste.md"]
    .filter((f) => fs.existsSync(path.join(buildDir, f)))

  if (createdFiles.length === 0) {
    printError("No spec files were created. Try running spec again.")
    return
  }

  // Update pipeline state
  advancePipeline(buildDir, buildName, "spec")

  printInfo("Created:")
  for (const f of createdFiles) {
    console.log(`  ${path.join(buildDir, f)}`)
  }

  if (!createdFiles.includes("spec.md")) {
    printError("Warning: spec.md was not created — this is required for planning")
  }
  if (!createdFiles.includes("constraints.md")) {
    printError("Warning: constraints.md was not created — this is required for planning")
  }

  console.log("")
  printInfo(`Spec ensemble: ${result.specialistResults.length} specialists + synthesizer`)
  printInfo(`Total cost: $${result.totalCostUsd.toFixed(2)}`)
  console.log("")
  printInfo(`Next: ridgeline plan ${buildName}`)
}
