import * as fs from "node:fs"
import * as path from "node:path"
import { printInfo, printError } from "../ui/output"
import { invokeSpecifier, SpecEnsembleConfig } from "../engine/pipeline/specify.exec"
import { advancePipeline, getMatchedShapes } from "../stores/state"

export type SpecOptions = {
  model: string
  timeout: number
  maxBudgetUsd?: number
  flavour?: string
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
    flavour: opts.flavour ?? null,
    matchedShapes: getMatchedShapes(buildDir),
  }

  const result = await invokeSpecifier(shapeMd, config)

  // Update pipeline state
  advancePipeline(buildDir, buildName, "spec")

  // Report created files
  console.log("")
  const createdFiles = ["spec.md", "constraints.md", "taste.md"]
    .filter((f) => fs.existsSync(path.join(buildDir, f)))

  printInfo("Created:")
  for (const f of createdFiles) {
    console.log(`  ${path.join(buildDir, f)}`)
  }

  if (!createdFiles.includes("taste.md")) {
    printInfo("Note: taste.md was not created (no style preferences in shape)")
  }

  console.log("")
  printInfo(`Spec ensemble: ${result.specialistResults.length} specialists + synthesizer`)
  printInfo(`Total cost: $${result.totalCostUsd.toFixed(2)}`)
  console.log("")
  printInfo(`Next: ridgeline plan ${buildName}`)
}
