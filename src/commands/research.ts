import * as fs from "node:fs"
import * as path from "node:path"
import { printInfo, printError } from "../ui/output"
import { invokeResearcher, ResearchConfig } from "../engine/pipeline/research.exec"
import { advancePipeline } from "../stores/state"
import { logTrajectory, makeTrajectoryEntry } from "../stores/trajectory"
import { recordCost } from "../stores/budget"
import { resolveResearchAllowlist } from "../stores/settings"
import { runRefine } from "./refine"

type ResearchOptions = {
  model: string
  timeout: number
  maxBudgetUsd?: number
  flavour?: string
  isDeep: boolean
  auto: number | null
}

const readBuildFile = (buildDir: string, filename: string): string | null => {
  const fp = path.join(buildDir, filename)
  return fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : null
}

/** Derive the next iteration number from existing research.md content. */
const deriveIterationNumber = (existingResearchMd: string | null): number => {
  if (!existingResearchMd) return 1
  const matches = existingResearchMd.match(/^### Iteration \d+/gm)
  return (matches?.length ?? 0) + 1
}

const runSingleResearch = async (
  buildName: string,
  buildDir: string,
  opts: ResearchOptions,
  iterationNumber?: number,
): Promise<void> => {
  const specMd = readBuildFile(buildDir, "spec.md")
  if (!specMd) {
    printError(`spec.md not found. Run 'ridgeline spec ${buildName}' first.`)
    return
  }

  const constraintsMd = readBuildFile(buildDir, "constraints.md")
  if (!constraintsMd) {
    printError(`constraints.md not found. Run 'ridgeline spec ${buildName}' first.`)
    return
  }

  const tasteMd = readBuildFile(buildDir, "taste.md")
  const existingResearchMd = readBuildFile(buildDir, "research.md")
  const changelogMd = readBuildFile(buildDir, "spec.changelog.md")
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")

  const iteration = iterationNumber ?? deriveIterationNumber(existingResearchMd)

  const config: ResearchConfig = {
    model: opts.model,
    timeoutMinutes: opts.timeout,
    maxBudgetUsd: opts.maxBudgetUsd ?? null,
    buildDir,
    flavour: opts.flavour ?? null,
    isDeep: opts.isDeep,
    networkAllowlist: resolveResearchAllowlist(ridgelineDir),
    existingResearchMd,
    changelogMd,
    iterationNumber: iteration,
  }

  logTrajectory(buildDir, makeTrajectoryEntry("research_start", null,
    `Research started (${opts.isDeep ? "deep" : "quick"} mode, iteration ${iteration})`))

  const result = await invokeResearcher(specMd, constraintsMd, tasteMd, config)

  // Record costs
  for (let i = 0; i < result.specialistResults.length; i++) {
    recordCost(buildDir, "research", "researcher", i, result.specialistResults[i])
  }
  recordCost(buildDir, "research", "synthesizer", 0, result.synthesizerResult)

  logTrajectory(buildDir, makeTrajectoryEntry("research_complete", null,
    `Research complete (${result.specialistResults.length} specialists, iteration ${iteration})`, {
      duration: result.totalDurationMs,
      tokens: {
        input: result.specialistResults.reduce((sum, r) => sum + r.usage.inputTokens, 0) + result.synthesizerResult.usage.inputTokens,
        output: result.specialistResults.reduce((sum, r) => sum + r.usage.outputTokens, 0) + result.synthesizerResult.usage.outputTokens,
      },
      costUsd: result.totalCostUsd,
    }))

  advancePipeline(buildDir, buildName, "research")

  printInfo(`\nResearch complete: ${result.specialistResults.length} specialist(s) + synthesizer (iteration ${iteration})`)
  printInfo(`Cost: $${result.totalCostUsd.toFixed(2)}`)
  printInfo(`Output: ${path.join(buildDir, "research.md")}`)
}

const runSingleRefine = async (
  buildName: string,
  _buildDir: string,
  opts: ResearchOptions,
  iterationNumber: number,
): Promise<void> => {
  await runRefine(buildName, {
    model: opts.model,
    timeout: opts.timeout,
    flavour: opts.flavour,
    iterationNumber,
  })
}

export const runResearch = async (buildName: string, opts: ResearchOptions): Promise<void> => {
  const buildDir = path.join(process.cwd(), ".ridgeline", "builds", buildName)

  if (!fs.existsSync(buildDir)) {
    printError(`Build directory not found: ${buildDir}`)
    return
  }

  if (opts.auto !== null) {
    // Auto mode: research → refine → research → refine ... for N iterations
    const iterations = opts.auto
    printInfo(`Auto-research: ${iterations} iteration(s) (${opts.isDeep ? "deep" : "quick"} mode)\n`)

    for (let i = 1; i <= iterations; i++) {
      printInfo(`--- Iteration ${i} of ${iterations} ---\n`)

      await runSingleResearch(buildName, buildDir, opts, i)
      await runSingleRefine(buildName, buildDir, opts, i)

      if (i < iterations) {
        printInfo("") // blank line between iterations
      }
    }

    printInfo(`\nAuto-research complete: ${iterations} iteration(s)`)
    printInfo(`Spec has been refined ${iterations} time(s).`)
    console.log("")
    printInfo(`Review: ${path.join(buildDir, "spec.md")}`)
    printInfo(`Next: ridgeline plan ${buildName}`)
  } else {
    // Manual mode: just run research, user will run refine separately
    await runSingleResearch(buildName, buildDir, opts)
    console.log("")
    printInfo("Review and edit research.md, then run:")
    printInfo(`  ridgeline refine ${buildName}`)
  }
}
