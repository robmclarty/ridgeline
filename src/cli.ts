#!/usr/bin/env node

import * as fs from "node:fs"
import * as path from "node:path"
import { Command } from "commander"
import { RidgelineConfig } from "./types"
import { resolveFile, parseCheckCommand } from "./state/inputs"
import { runSpec } from "./commands/spec"
import { runPlan } from "./commands/plan"
import { runDryRun } from "./commands/dryRun"
import { runBuild } from "./commands/build"

// Load version from package.json at runtime
const loadVersion = (): string => {
  // Try dist location first (installed), then source root
  for (const rel of [path.join(__dirname, "..", "package.json"), path.join(__dirname, "..", "..", "package.json")]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(rel, "utf-8"))
      if (pkg.version) return pkg.version
    } catch {
      // Try next path
    }
  }
  return "0.0.0"
}

// Build RidgelineConfig from command options
export const resolveConfig = (buildName: string, opts: Record<string, string | boolean | undefined>): RidgelineConfig => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = path.join(ridgelineDir, "builds", buildName)
  const phasesDir = path.join(buildDir, "phases")

  const constraintsPath = resolveFile(
    opts.constraints as string | undefined,
    buildDir,
    "constraints.md",
    ridgelineDir
  )
  if (!constraintsPath) {
    throw new Error(
      `constraints.md not found. Checked:\n` +
      `  - ${buildDir}/constraints.md\n` +
      `  - ${ridgelineDir}/constraints.md\n` +
      `Create one with 'ridgeline spec ${buildName}' or pass --constraints <path>`
    )
  }

  const tastePath = resolveFile(
    opts.taste as string | undefined,
    buildDir,
    "taste.md",
    ridgelineDir
  )

  const checkCommand = (opts.check as string) ?? parseCheckCommand(constraintsPath)

  return {
    buildName,
    ridgelineDir,
    buildDir,
    constraintsPath,
    tastePath,
    handoffPath: path.join(buildDir, "handoff.md"),
    phasesDir,
    model: (opts.model as string) ?? "opus",
    maxRetries: parseInt(String(opts.maxRetries ?? "2"), 10),
    timeoutMinutes: parseInt(String(opts.timeout ?? "120"), 10),
    checkTimeoutSeconds: parseInt(String(opts.checkTimeout ?? "1200"), 10),
    checkCommand,
    maxBudgetUsd: opts.maxBudgetUsd ? parseFloat(String(opts.maxBudgetUsd)) : null,
  }
}

const askBuildName = async (): Promise<string> => {
  const readline = require("node:readline")
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const name = await new Promise<string>((resolve) => {
    rl.question("Build name: ", (answer: string) => {
      rl.close()
      resolve(answer.trim())
    })
  })
  return name
}

const program = new Command()

program
  .name("ridgeline")
  .description("Build harness for long-horizon software execution")
  .version(loadVersion())

program
  .command("spec [build-name] [input]")
  .description("Scaffold build input files from a description or existing spec")
  .option("--model <name>", "Model for spec assistant", "opus")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10")
  .action(async (buildName: string | undefined, input: string | undefined, opts: Record<string, string | boolean | undefined>) => {
    if (!buildName) buildName = await askBuildName()
    if (!buildName) {
      console.error("Build name is required")
      process.exit(1)
    }
    try {
      await runSpec(buildName, {
        model: (opts.model as string) ?? "opus",
        timeout: parseInt(String(opts.timeout ?? "10"), 10),
        input,
      })
    } catch (err) {
      console.error(`Error: ${err}`)
      process.exit(1)
    }
  })

program
  .command("plan [build-name]")
  .description("Generate phase specs from spec.md and constraints.md")
  .option("--model <name>", "Model for planner", "opus")
  .option("--timeout <minutes>", "Max duration for planning", "120")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .action(async (buildName: string | undefined, opts: Record<string, string | boolean | undefined>) => {
    if (!buildName) buildName = await askBuildName()
    try {
      const config = resolveConfig(buildName!, opts)
      await runPlan(config)
    } catch (err) {
      console.error(`Error: ${err}`)
      process.exit(1)
    }
  })

program
  .command("dry-run [build-name]")
  .description("Display the plan without executing")
  .option("--model <name>", "Model for planner", "opus")
  .option("--timeout <minutes>", "Max duration for planning", "120")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .action(async (buildName: string | undefined, opts: Record<string, string | boolean | undefined>) => {
    if (!buildName) buildName = await askBuildName()
    try {
      const config = resolveConfig(buildName!, opts)
      await runDryRun(config)
    } catch (err) {
      console.error(`Error: ${err}`)
      process.exit(1)
    }
  })

program
  .command("build [build-name]")
  .description("Execute the build pipeline (automatically resumes from last successful phase)")
  .option("--timeout <minutes>", "Max duration per phase in minutes", "120")
  .option("--check-timeout <seconds>", "Max duration for check command in seconds", "1200")
  .option("--max-retries <n>", "Max reviewer retry loops per phase", "2")
  .option("--check <command>", "Baseline check command (overrides constraints.md)")
  .option("--model <name>", "Model for builder and reviewer", "opus")
  .option("--max-budget-usd <n>", "Halt if cumulative cost exceeds this amount")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .action(async (buildName: string | undefined, opts: Record<string, string | boolean | undefined>) => {
    if (!buildName) buildName = await askBuildName()
    try {
      const config = resolveConfig(buildName!, opts)
      await runBuild(config)
    } catch (err) {
      console.error(`Error: ${err}`)
      process.exit(1)
    }
  })

program.parse()
