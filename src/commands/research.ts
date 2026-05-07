import * as fs from "node:fs"
import * as path from "node:path"
import { run } from "fascicle"
import { printInfo, printError } from "../ui/output.js"
import { runResearchEnsemble, type ResearchConfig } from "../engine/researcher.js"
import { advancePipeline } from "../stores/state.js"
import { logTrajectory } from "../stores/trajectory.js"
import { recordCost } from "../stores/budget.js"
import {
  resolveResearchAllowlist,
  resolveSandboxMode,
  DEFAULT_SPECIALIST_TIMEOUT_SECONDS,
  DEFAULT_SPECIALIST_COUNT,
} from "../stores/settings.js"
import { printResearchSummary } from "../ui/summary.js"
import { runRefine } from "./refine.js"
import { makeRidgelineEngine } from "../engine/engine.factory.js"
import { researchFlow, type ResearchFlowInput } from "../engine/flows/research.flow.js"

type ResearchOptions = {
  model: string
  timeout: number
  maxBudgetUsd?: number
  isQuick: boolean
  auto: number | null
  specialistCount?: 1 | 2 | 3
  specialistTimeoutSeconds?: number
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

  const engine = makeRidgelineEngine({
    sandboxFlag: resolveSandboxMode(ridgelineDir, undefined),
    timeoutMinutes: opts.timeout,
    pluginDirs: [],
    settingSources: ["user", "project", "local"],
    buildPath: buildDir,
  })

  const flow = researchFlow({
    executor: async (input: ResearchFlowInput) => {
      const config: ResearchConfig = {
        model: opts.model,
        timeoutMinutes: opts.timeout,
        specialistTimeoutSeconds: opts.specialistTimeoutSeconds ?? DEFAULT_SPECIALIST_TIMEOUT_SECONDS,
        maxBudgetUsd: opts.maxBudgetUsd ?? null,
        buildDir: input.buildDir,
        isQuick: input.isQuick,
        specialistCount: opts.specialistCount ?? DEFAULT_SPECIALIST_COUNT,
        networkAllowlist: resolveResearchAllowlist(ridgelineDir),
        existingResearchMd,
        changelogMd,
        iterationNumber: input.iterationNumber,
      }
      return runResearchEnsemble(input.specMd, input.constraintsMd, input.tasteMd, config)
    },
  })

  logTrajectory(buildDir, "research_start", null,
    `Research started (${opts.isQuick ? "quick" : "full"} mode, iteration ${iteration})`)

  let result
  try {
    const out = await run(flow, {
      specMd,
      constraintsMd,
      tasteMd,
      buildDir,
      buildName,
      iterationNumber: iteration,
      isQuick: opts.isQuick,
    }, { install_signal_handlers: false })
    result = out.ensemble
  } finally {
    await engine.dispose()
  }

  // Record costs
  for (let i = 0; i < result.specialistResults.length; i++) {
    recordCost(buildDir, "research", "researcher", i, result.specialistResults[i])
  }
  recordCost(buildDir, "research", "synthesizer", 0, result.synthesizerResult)

  logTrajectory(buildDir, "research_complete", null,
    `Research complete (${result.specialistResults.length} specialists, iteration ${iteration})`, {
      duration: result.totalDurationMs,
      tokens: {
        input: result.specialistResults.reduce((sum, r) => sum + r.usage.inputTokens, 0) + result.synthesizerResult.usage.inputTokens,
        output: result.specialistResults.reduce((sum, r) => sum + r.usage.outputTokens, 0) + result.synthesizerResult.usage.outputTokens,
      },
      costUsd: result.totalCostUsd,
    })

  advancePipeline(buildDir, buildName, "research")

  printResearchSummary({
    buildName,
    buildDir,
    iteration,
    specialistNames: result.specialistNames,
    specialistResults: result.specialistResults,
    synthesizerResult: result.synthesizerResult,
    totalCostUsd: result.totalCostUsd,
  })
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
    printInfo(`Auto-research: ${iterations} iteration(s) (${opts.isQuick ? "quick" : "full"} mode)\n`)

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
