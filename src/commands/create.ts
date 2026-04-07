import * as fs from "node:fs"
import * as path from "node:path"
import { printInfo } from "../ui/output"
import { getPipelineStatus, getNextPipelineStage } from "../store/state"
import { PipelineStage } from "../types"
import { runShape, ShapeOptions } from "./shape"
import { runSpec, SpecOptions } from "./spec"
import { resolveConfig } from "../config"
import { runPlan } from "./plan"
import { runBuild } from "./build"

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
  input?: string
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  shape: "shape.md",
  spec: "spec.md",
  plan: "phases/",
  build: "build",
}

const STATUS_ICONS: Record<string, string> = {
  complete: "done",
  running: "running",
  pending: "---",
}

export const runCreate = async (buildName: string, opts: CreateOptions): Promise<void> => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = path.join(ridgelineDir, "builds", buildName)

  // Ensure build directory exists
  fs.mkdirSync(path.join(buildDir, "phases"), { recursive: true })

  const status = getPipelineStatus(buildDir)
  const nextStage = getNextPipelineStage(buildDir)

  // Display status table
  console.log("")
  printInfo(`Build: ${buildName}`)
  console.log("")
  for (const stage of ["shape", "spec", "plan", "build"] as PipelineStage[]) {
    const icon = STATUS_ICONS[status[stage]] ?? "---"
    const label = STAGE_LABELS[stage]
    console.log(`  ${label.padEnd(16)} ${icon}`)
  }
  console.log("")

  if (!nextStage) {
    printInfo("All stages complete.")
    return
  }

  printInfo(`Starting: ridgeline ${nextStage} ${buildName}`)
  console.log("")

  switch (nextStage) {
    case "shape": {
      const shapeOpts: ShapeOptions = {
        model: opts.model,
        timeout: parseInt(opts.timeout, 10),
        input: opts.input,
      }
      await runShape(buildName, shapeOpts)
      break
    }
    case "spec": {
      const specOpts: SpecOptions = {
        model: opts.model,
        timeout: parseInt(opts.timeout, 10),
        maxBudgetUsd: opts.maxBudgetUsd ? parseFloat(opts.maxBudgetUsd) : undefined,
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
        maxBudgetUsd: opts.maxBudgetUsd,
      })
      await runBuild(config)
      break
    }
  }
}
