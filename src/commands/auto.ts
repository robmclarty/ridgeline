import * as fs from "node:fs"
import * as path from "node:path"
import { printInfo, printError, printWarn } from "../ui/output.js"
import {
  getNextPipelineStage,
  getPipelineStatus,
  getMatchedShapes,
} from "../stores/state.js"
import { PipelineStage } from "../types.js"
import { resolveBuildDir } from "../config.js"
import { resolveSpecialistTimeoutSeconds } from "../stores/settings.js"
import { runCreate, CreateOptions, persistInputSourceIfPath } from "./create.js"
import { runDirectionsAuto } from "./directions.js"
import { runResearch } from "./research.js"
import { runRetrospective } from "./retrospective.js"
import { runRetroRefine } from "./retro-refine.js"

export type StopAfter = "shape" | "design" | "spec" | "plan" | "build"

const STAGE_ORDER: StopAfter[] = ["shape", "design", "spec", "plan", "build"]

const stageRank = (stage: PipelineStage | StopAfter): number => {
  const idx = STAGE_ORDER.indexOf(stage as StopAfter)
  return idx === -1 ? Number.POSITIVE_INFINITY : idx
}

type AutoOptions = CreateOptions & {
  stopAfter?: StopAfter
  isNoRefine?: boolean
  /** Number of research+refine iterations. undefined = research is off. */
  research?: number
  /** Number of parallel directions to generate. undefined = directions is off. */
  directions?: number
  /** Inspiration source for the directions picker (file/dir/text). */
  inspiration?: string
}

const VISUAL_SHAPES: ReadonlySet<string> = new Set(["web-visual", "game-visual", "print-layout"])

const printStageBanner = (label: string): void => {
  console.log("")
  printInfo(`── ${label} ──`)
}

const validateAutoPreconditions = (buildDir: string, opts: AutoOptions): void => {
  if (opts.stopAfter && !STAGE_ORDER.includes(opts.stopAfter)) {
    throw new Error(
      `Invalid --stop-after value "${opts.stopAfter}". Allowed: ${STAGE_ORDER.join(", ")}`,
    )
  }
  const shapePath = path.join(buildDir, "shape.md")
  if (!opts.input && !fs.existsSync(shapePath)) {
    throw new Error(
      `--auto requires an input argument when shape.md does not yet exist. ` +
        `Pass an input path or run shape first.`,
    )
  }
}

const isShapeVisual = (buildDir: string): boolean => {
  const matched = getMatchedShapes(buildDir)
  return matched.some((name) => VISUAL_SHAPES.has(name))
}

/** Run the directions-auto stage, return true if it ran. Errors are surfaced. */
const runDirectionsInsertion = async (
  buildName: string, buildDir: string, opts: AutoOptions, next: PipelineStage,
): Promise<boolean> => {
  if (!opts.directions || next !== "spec" || !isShapeVisual(buildDir)) return false
  printStageBanner(`directions (auto, ${opts.directions} specialists)`)
  await runDirectionsAuto(buildName, {
    model: opts.model,
    timeout: parseInt(opts.timeout, 10),
    count: opts.directions,
    inspiration: opts.inspiration,
  })
  return true
}

const runResearchInsertion = async (
  buildName: string, opts: AutoOptions, next: PipelineStage,
): Promise<boolean> => {
  if (!opts.research || next !== "plan") return false
  printStageBanner(`research + refine (auto, ${opts.research} iteration(s))`)
  await runResearch(buildName, {
    model: opts.model,
    timeout: parseInt(opts.timeout, 10),
    maxBudgetUsd: opts.maxBudgetUsd ? parseFloat(opts.maxBudgetUsd) : undefined,
    isQuick: false,
    auto: opts.research,
    specialistCount: opts.specialistCount,
    specialistTimeoutSeconds: resolveSpecialistTimeoutSeconds(
      path.join(process.cwd(), ".ridgeline"),
    ),
  })
  return true
}

const runTailHooks = async (
  buildName: string, buildDir: string, opts: AutoOptions,
): Promise<void> => {
  printStageBanner("retrospective (auto)")
  try {
    await runRetrospective(buildName, {
      model: opts.model,
      timeout: parseInt(opts.timeout, 10),
    })
  } catch (err) {
    printWarn(`retrospective failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!opts.isNoRefine) {
    printStageBanner("retro-refine (auto)")
    try {
      await runRetroRefine(buildName, {
        model: opts.model,
        timeout: parseInt(opts.timeout, 10),
      })
    } catch (err) {
      printWarn(`retro-refine failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log("")
  printInfo(`Auto run complete for build "${buildName}".`)
  const learningsPath = path.join(process.cwd(), ".ridgeline", "learnings.md")
  if (fs.existsSync(learningsPath)) {
    printInfo(`Learnings: ${path.relative(process.cwd(), learningsPath)}`)
  }
  if (!opts.isNoRefine) {
    const refinedPath = path.join(buildDir, "refined-input.md")
    if (fs.existsSync(refinedPath)) {
      printInfo(`Refined input: ${path.relative(process.cwd(), refinedPath)}`)
    }
  }
}

const runStageWithErrorHandling = async (
  stageLabel: string,
  fn: () => Promise<void>,
): Promise<boolean> => {
  try {
    await fn()
    return true
  } catch (err) {
    printError(`${stageLabel} stage failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/**
 * End-to-end auto orchestrator. Loops runCreate until the pipeline is
 * complete or the stopAfter boundary is hit, with two opt-in insertions:
 * directions (between shape and design) and research+refine (between spec
 * and plan). At the tail of a successful run, appends a retrospective and
 * (unless --no-refine) writes refined-input.md.
 */
export const runAuto = async (buildName: string, opts: AutoOptions): Promise<void> => {
  const buildDir = resolveBuildDir(buildName, { ensure: true })
  validateAutoPreconditions(buildDir, opts)
  persistInputSourceIfPath(buildDir, buildName, opts.input)

  const stopAfter = opts.stopAfter ?? "build"
  const stopRank = stageRank(stopAfter)

  printInfo(`Build: ${buildName}`)
  printInfo(`Auto mode — stop-after: ${stopAfter}`)
  if (opts.directions) printInfo(`Directions: ${opts.directions} parallel specialist(s)`)
  if (opts.research) printInfo(`Research: ${opts.research} iteration(s)`)
  if (opts.inspiration) printInfo(`Inspiration: ${opts.inspiration}`)

  let directionsDone = false
  let researchDone = false

  // Hard cap to prevent any infinite loop bug from runaway costs.
  const MAX_ITERATIONS = 16
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const next = getNextPipelineStage(buildDir)
    if (!next) break
    if (stageRank(next) > stopRank) {
      printInfo(`Reached stop-after boundary (${stopAfter}); halting.`)
      return
    }

    if (!directionsDone) {
      const ok = await runStageWithErrorHandling("directions", () =>
        runDirectionsInsertion(buildName, buildDir, opts, next).then((ran) => {
          if (ran) directionsDone = true
        }),
      )
      if (!ok) return
      if (directionsDone) continue
    }

    if (!researchDone) {
      const ok = await runStageWithErrorHandling("research", () =>
        runResearchInsertion(buildName, opts, next).then((ran) => {
          if (ran) researchDone = true
        }),
      )
      if (!ok) return
      if (researchDone) continue
    }

    printStageBanner(`${next} (auto)`)
    const ok = await runStageWithErrorHandling(next, () =>
      runCreate(buildName, { ...opts, isAuto: true, isQuiet: true }),
    )
    if (!ok) return
  }

  if (getPipelineStatus(buildDir).build !== "complete") {
    printInfo("Auto run halted before build completion; skipping retrospective and retro-refine.")
    return
  }
  await runTailHooks(buildName, buildDir, opts)
}
