import * as path from "node:path"
import { printInfo } from "../ui/output"
import {
  getPipelineStatus,
  getNextPipelineStage,
  recordInputSource,
} from "../stores/state"
import { PipelineStage } from "../types"
import { runShape, runShapeAuto, ShapeOptions } from "./shape"
import { runSpec, SpecOptions } from "./spec"
import { resolveBuildDir, resolveConfig } from "../config"
import { resolveSpecialistTimeoutSeconds } from "../stores/settings"
import { runPlan } from "./plan"
import { runBuild } from "./build"
import { resolveInputBundle } from "./input"

export type CreateOptions = {
  model: string
  timeout: string
  maxBudgetUsd?: string
  constraints?: string
  taste?: string
  maxRetries?: string
  check?: string
  checkTimeout?: string
  context?: string
  unsafe?: boolean
  sandbox?: string
  input?: string
  /** Skip Q&A; route shape to runShapeAuto. spec/plan/build are already non-interactive. */
  isAuto?: boolean
  /** Suppress the status table — used when called from the runAuto orchestrator. */
  isQuiet?: boolean
  /** Number of specialists for ensemble stages (forwarded to runSpec). */
  specialistCount?: 1 | 2 | 3
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  shape: "shape.md",
  design: "design.md",
  spec: "spec.md",
  research: "research.md",
  refine: "refine",
  plan: "phases/",
  build: "build",
}

const STATUS_ICONS: Record<string, string> = {
  complete: "done",
  running: "running",
  pending: "---",
}

const DISPLAY_STAGES: PipelineStage[] = [
  "shape", "design", "spec", "research", "refine", "plan", "build",
]

const printStatusTable = (buildName: string, buildDir: string): void => {
  const status = getPipelineStatus(buildDir)
  console.log("")
  printInfo(`Build: ${buildName}`)
  console.log("")
  for (const stage of DISPLAY_STAGES) {
    const icon = STATUS_ICONS[status[stage]] ?? (status[stage] === "skipped" ? "skip" : "---")
    console.log(`  ${STAGE_LABELS[stage].padEnd(16)} ${icon}`)
  }
  console.log("")
}

/**
 * Persist the original input path to state.json when the user supplied a
 * file or directory as input. Inline text inputs are not recorded — there
 * is no source path to come back to.
 */
export const persistInputSourceIfPath = (buildDir: string, buildName: string, input?: string): void => {
  if (!input) return
  try {
    const bundle = resolveInputBundle(input)
    if (bundle.type === "file" || bundle.type === "directory") {
      recordInputSource(buildDir, buildName, bundle.path)
    }
  } catch {
    // Bad path / unreadable directory: don't fail the run; just skip recording.
  }
}

export const runCreate = async (buildName: string, opts: CreateOptions): Promise<void> => {
  const buildDir = resolveBuildDir(buildName, { ensure: true })
  persistInputSourceIfPath(buildDir, buildName, opts.input)

  const nextStage = getNextPipelineStage(buildDir)

  if (!opts.isQuiet) {
    printStatusTable(buildName, buildDir)
  }

  if (!nextStage) {
    if (!opts.isQuiet) printInfo("All stages complete.")
    return
  }

  if (!opts.isQuiet) {
    printInfo(`Starting: ridgeline ${nextStage} ${buildName}`)
    console.log("")
  }

  switch (nextStage) {
    case "shape": {
      const shapeOpts: ShapeOptions = {
        model: opts.model,
        timeout: parseInt(opts.timeout, 10),
        input: opts.input,
      }
      if (opts.isAuto) {
        if (!opts.input) {
          throw new Error("Auto mode requires an input argument for the shape stage.")
        }
        const bundle = resolveInputBundle(opts.input)
        await runShapeAuto(buildName, {
          ...shapeOpts,
          inputContent: bundle.content,
          inputLabel: bundle.type === "file"
            ? bundle.path
            : bundle.type === "directory"
              ? `${bundle.path} (${bundle.files.length} files)`
              : "inline text",
        })
      } else {
        await runShape(buildName, shapeOpts)
      }
      break
    }
    case "spec": {
      const specOpts: SpecOptions = {
        model: opts.model,
        timeout: parseInt(opts.timeout, 10),
        maxBudgetUsd: opts.maxBudgetUsd ? parseFloat(opts.maxBudgetUsd) : undefined,
        specialistCount: opts.specialistCount,
        specialistTimeoutSeconds: resolveSpecialistTimeoutSeconds(path.join(process.cwd(), ".ridgeline")),
      }
      await runSpec(buildName, specOpts)
      break
    }
    case "plan": {
      const config = resolveConfig(buildName, {
        model: opts.model,
        timeout: opts.timeout,
        constraints: opts.constraints,
        taste: opts.taste,
      })
      await runPlan(config)
      break
    }
    case "build": {
      const config = resolveConfig(buildName, {
        model: opts.model,
        timeout: opts.timeout,
        maxRetries: opts.maxRetries,
        check: opts.check,
        checkTimeout: opts.checkTimeout,
        constraints: opts.constraints,
        taste: opts.taste,
        context: opts.context,
        unsafe: opts.unsafe,
        sandbox: opts.sandbox,
        maxBudgetUsd: opts.maxBudgetUsd,
      })
      await runBuild(config)
      break
    }
  }
}
