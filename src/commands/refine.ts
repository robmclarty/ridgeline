import * as fs from "node:fs"
import * as path from "node:path"
import { run } from "fascicle"
import { printInfo, printError } from "../ui/output.js"
import { runRefiner, type RefineConfig } from "../engine/refiner.js"
import { advancePipeline } from "../stores/state.js"
import { logTrajectory } from "../stores/trajectory.js"
import { recordCost } from "../stores/budget.js"
import { makeRidgelineEngine } from "../engine/engine.factory.js"
import { refineFlow, type RefineFlowInput } from "../engine/flows/refine.flow.js"
import { resolveSandboxMode } from "../stores/settings.js"

type RefineOptions = {
  model: string
  timeout: number
  iterationNumber?: number
}

const deriveRefineIterationNumber = (changelogMd: string | null): number => {
  if (!changelogMd) return 1
  const matches = changelogMd.match(/^## Iteration \d+/gm)
  return (matches?.length ?? 0) + 1
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
  const changelogPath = path.join(buildDir, "spec.changelog.md")
  const changelogMd = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, "utf-8") : null

  const iterationNumber = opts.iterationNumber ?? deriveRefineIterationNumber(changelogMd)

  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const engine = makeRidgelineEngine({
    sandboxFlag: resolveSandboxMode(ridgelineDir, undefined),
    timeoutMinutes: opts.timeout,
    pluginDirs: [],
    settingSources: ["user", "project", "local"],
    buildPath: buildDir,
  })

  const flow = refineFlow({
    executor: async (input: RefineFlowInput) => {
      const config: RefineConfig = {
        model: input.model,
        timeoutMinutes: input.timeoutMinutes,
        buildDir: input.buildDir,
        changelogMd: input.changelogMd,
        iterationNumber: input.iterationNumber,
      }
      return runRefiner(input.specMd, input.researchMd, input.constraintsMd, input.tasteMd, config)
    },
  })

  logTrajectory(buildDir, "refine_start", null, `Refine started (iteration ${iterationNumber})`)

  let result
  try {
    const out = await run(flow, {
      specMd,
      researchMd,
      constraintsMd,
      tasteMd,
      model: opts.model,
      timeoutMinutes: opts.timeout,
      buildDir,
      changelogMd,
      iterationNumber,
    }, { install_signal_handlers: false })
    result = out.result
  } finally {
    await engine.dispose()
  }

  recordCost(buildDir, "refine", "refiner", 0, result)

  logTrajectory(buildDir, "refine_complete", null, `Refine complete (iteration ${iterationNumber})`, {
    duration: result.durationMs,
    tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens },
    costUsd: result.costUsd,
  })

  advancePipeline(buildDir, buildName, "refine")

  printInfo(`\nSpec refined with research findings (iteration ${iterationNumber}).`)
  printInfo(`Cost: $${result.costUsd.toFixed(2)}`)
  console.log("")
  printInfo(`Review: ${path.join(buildDir, "spec.md")}`)
  printInfo(`Changelog: ${path.join(buildDir, "spec.changelog.md")}`)
  printInfo(`Next: ridgeline plan ${buildName}`)
}
