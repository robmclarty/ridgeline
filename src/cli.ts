#!/usr/bin/env node

import { Command } from "commander"
import { loadVersion, resolveConfig } from "./config"
import { askBuildName } from "./ui/prompt"
import { runSpec } from "./commands/spec"
import { runPlan } from "./commands/plan"
import { runDryRun } from "./commands/dryRun"
import { runBuild } from "./commands/build"

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
  .option("--unsafe", "Disable sandbox auto-detection")
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
