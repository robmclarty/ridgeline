#!/usr/bin/env node

import * as fs from "node:fs"
import * as path from "node:path"
import { Command } from "commander"
import { RidgelineConfig } from "./types"
import { runInit } from "./commands/init"
import { runPlan } from "./commands/plan"
import { runDryRun } from "./commands/dryRun"
import { runBuild } from "./commands/run"
import { runResume } from "./commands/resume"

// Resolve a file through the fallback chain: CLI flag > build-level > project-level
export const resolveFile = (
  cliFlag: string | undefined,
  buildDir: string,
  filename: string,
  projectDir: string
): string | null => {
  if (cliFlag && fs.existsSync(cliFlag)) return path.resolve(cliFlag)
  const buildLevel = path.join(buildDir, filename)
  if (fs.existsSync(buildLevel)) return buildLevel
  const projectLevel = path.join(projectDir, filename)
  if (fs.existsSync(projectLevel)) return projectLevel
  return null
}

// Parse the check command from constraints.md
export const parseCheckCommand = (constraintsPath: string): string | null => {
  try {
    const content = fs.readFileSync(constraintsPath, "utf-8")
    const match = content.match(/## Check Command\s*\n+```[^\n]*\n([\s\S]*?)```/)
    return match ? match[1].trim() : null
  } catch {
    return null
  }
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
      `Create one with 'ridgeline init ${buildName}' or pass --constraints <path>`
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
    buildDir,
    constraintsPath,
    tastePath,
    snapshotPath: path.join(buildDir, "snapshot.md"),
    handoffPath: path.join(buildDir, "handoff.md"),
    phasesDir,
    model: (opts.model as string) ?? "opus",
    maxRetries: parseInt(String(opts.maxRetries ?? "2"), 10),
    timeoutMinutes: parseInt(String(opts.timeout ?? "30"), 10),
    verbose: Boolean(opts.verbose),
    checkCommand,
    maxBudgetUsd: opts.maxBudgetUsd ? parseFloat(String(opts.maxBudgetUsd)) : null,
  }
}

const program = new Command()

program
  .name("ridgeline")
  .description("Build harness for long-horizon software execution")
  .version("0.1.1")

program
  .command("init [build-name]")
  .description("Interactive helper to scaffold build input files")
  .action(async (buildName?: string) => {
    if (!buildName) {
      const readline = require("node:readline")
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      buildName = await new Promise<string>((resolve) => {
        rl.question("Build name: ", (answer: string) => {
          rl.close()
          resolve(answer.trim())
        })
      })
    }
    if (!buildName) {
      console.error("Build name is required")
      process.exit(1)
    }
    try {
      await runInit(buildName)
    } catch (err) {
      console.error(`Error: ${err}`)
      process.exit(1)
    }
  })

program
  .command("plan [build-name]")
  .description("Generate phase specs from spec.md and constraints.md")
  .option("--model <name>", "Model for planner", "opus")
  .option("--verbose", "Stream planner output to terminal", false)
  .option("--timeout <minutes>", "Max duration for planning", "30")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .action(async (buildName: string | undefined, opts: Record<string, string | boolean | undefined>) => {
    if (!buildName) {
      const readline = require("node:readline")
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      buildName = await new Promise<string>((resolve) => {
        rl.question("Build name: ", (answer: string) => {
          rl.close()
          resolve(answer.trim())
        })
      })
    }
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
  .option("--verbose", "Stream planner output to terminal", false)
  .option("--timeout <minutes>", "Max duration for planning", "30")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .action(async (buildName: string | undefined, opts: Record<string, string | boolean | undefined>) => {
    if (!buildName) {
      const readline = require("node:readline")
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      buildName = await new Promise<string>((resolve) => {
        rl.question("Build name: ", (answer: string) => {
          rl.close()
          resolve(answer.trim())
        })
      })
    }
    try {
      const config = resolveConfig(buildName!, opts)
      await runDryRun(config)
    } catch (err) {
      console.error(`Error: ${err}`)
      process.exit(1)
    }
  })

program
  .command("run [build-name]")
  .description("Execute the build pipeline")
  .option("--verbose", "Stream builder/reviewer output to terminal", false)
  .option("--timeout <minutes>", "Max duration per phase in minutes", "30")
  .option("--max-retries <n>", "Max reviewer retry loops per phase", "2")
  .option("--check <command>", "Baseline check command (overrides constraints.md)")
  .option("--model <name>", "Model for builder and reviewer", "opus")
  .option("--max-budget-usd <n>", "Halt if cumulative cost exceeds this amount")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .action(async (buildName: string | undefined, opts: Record<string, string | boolean | undefined>) => {
    if (!buildName) {
      const readline = require("node:readline")
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      buildName = await new Promise<string>((resolve) => {
        rl.question("Build name: ", (answer: string) => {
          rl.close()
          resolve(answer.trim())
        })
      })
    }
    try {
      const config = resolveConfig(buildName!, opts)
      await runBuild(config)
    } catch (err) {
      console.error(`Error: ${err}`)
      process.exit(1)
    }
  })

program
  .command("resume [build-name]")
  .description("Resume from the last successful phase")
  .option("--verbose", "Stream builder/reviewer output to terminal", false)
  .option("--timeout <minutes>", "Max duration per phase in minutes", "30")
  .option("--max-retries <n>", "Max reviewer retry loops per phase", "2")
  .option("--check <command>", "Baseline check command (overrides constraints.md)")
  .option("--model <name>", "Model for builder and reviewer", "opus")
  .option("--max-budget-usd <n>", "Halt if cumulative cost exceeds this amount")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .action(async (buildName: string | undefined, opts: Record<string, string | boolean | undefined>) => {
    if (!buildName) {
      const readline = require("node:readline")
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      buildName = await new Promise<string>((resolve) => {
        rl.question("Build name: ", (answer: string) => {
          rl.close()
          resolve(answer.trim())
        })
      })
    }
    try {
      const config = resolveConfig(buildName!, opts)
      await runResume(config)
    } catch (err) {
      console.error(`Error: ${err}`)
      process.exit(1)
    }
  })

program.parse()
