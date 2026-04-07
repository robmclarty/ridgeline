#!/usr/bin/env node

import { Command } from "commander"
import { loadVersion, resolveConfig } from "./config"
import { RidgelineConfig } from "./types"
import { askBuildName } from "./ui/prompt"
import { runShape } from "./commands/shape"
import { runSpec } from "./commands/spec"
import { runPlan } from "./commands/plan"
import { runDryRun } from "./commands/dry-run"
import { runBuild } from "./commands/build"
import { runCreate } from "./commands/create"
import { runRewind } from "./commands/rewind"
import { killAllClaude } from "./engine/claude/claude.exec"

// Kill all Claude subprocesses on Ctrl+C before exiting
process.on("SIGINT", () => {
  killAllClaude()
  setTimeout(() => process.exit(130), 2500)
})

type Opts = Record<string, string | boolean | undefined>

const withConfig = (fn: (config: RidgelineConfig) => Promise<void>) =>
  async (buildName: string | undefined, opts: Opts) => {
    if (!buildName) buildName = await askBuildName()
    try {
      const config = resolveConfig(buildName!, opts)
      await fn(config)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  }

const program = new Command()

program
  .name("ridgeline")
  .description("Build harness for long-horizon software execution")
  .version(loadVersion())

// Default command: `ridgeline <build-name> [input]`
// Dispatches to the next incomplete pipeline stage
program
  .argument("[build-name]", "Build name")
  .argument("[input]", "Description text or path to input file")
  .option("--model <name>", "Model for all stages", "opus")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10")
  .option("--max-budget-usd <n>", "Halt if cumulative cost exceeds this amount")
  .option("--max-retries <n>", "Max reviewer retry loops per phase", "2")
  .option("--check <command>", "Baseline check command (overrides constraints.md)")
  .option("--check-timeout <seconds>", "Max duration for check command in seconds", "1200")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .option("--context <text>", "Extra context appended to builder and planner prompts")
  .option("--unsafe", "Disable sandbox auto-detection")
  .action(async (buildName: string | undefined, input: string | undefined, opts: Opts) => {
    // If the first arg looks like a known subcommand, skip default handling
    // (Commander will route it to the subcommand instead)
    if (!buildName) buildName = await askBuildName()
    if (!buildName) {
      console.error("Build name is required")
      process.exit(1)
    }
    try {
      await runCreate(buildName, {
        model: (opts.model as string) ?? "opus",
        timeout: String(opts.timeout ?? "10"),
        maxBudgetUsd: opts.maxBudgetUsd as string | undefined,
        maxRetries: opts.maxRetries as string | undefined,
        check: opts.check as string | undefined,
        checkTimeout: opts.checkTimeout as string | undefined,
        constraints: opts.constraints as string | undefined,
        taste: opts.taste as string | undefined,
        context: opts.context as string | undefined,
        unsafe: opts.unsafe === true,
        input,
      })
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command("shape [build-name] [input]")
  .description("Gather project context and produce shape.md")
  .option("--model <name>", "Model for shaper agent", "opus")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10")
  .action(async (buildName: string | undefined, input: string | undefined, opts: Opts) => {
    if (!buildName) buildName = await askBuildName()
    if (!buildName) {
      console.error("Build name is required")
      process.exit(1)
    }
    try {
      await runShape(buildName, {
        model: (opts.model as string) ?? "opus",
        timeout: parseInt(String(opts.timeout ?? "10"), 10),
        input,
      })
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command("spec [build-name]")
  .description("Generate spec.md, constraints.md, and taste.md from shape.md via ensemble")
  .option("--model <name>", "Model for specialists and synthesizer", "opus")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10")
  .option("--max-budget-usd <n>", "Halt if cumulative cost exceeds this amount")
  .action(async (buildName: string | undefined, opts: Opts) => {
    if (!buildName) buildName = await askBuildName()
    if (!buildName) {
      console.error("Build name is required")
      process.exit(1)
    }
    try {
      await runSpec(buildName, {
        model: (opts.model as string) ?? "opus",
        timeout: parseInt(String(opts.timeout ?? "10"), 10),
        maxBudgetUsd: opts.maxBudgetUsd ? parseFloat(String(opts.maxBudgetUsd)) : undefined,
      })
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
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
  .action(withConfig(runPlan))

program
  .command("dry-run [build-name]")
  .description("Display the plan without executing")
  .option("--model <name>", "Model for planner", "opus")
  .option("--timeout <minutes>", "Max duration for planning", "120")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .action(withConfig(runDryRun))

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
  .option("--context <text>", "Extra context appended to builder and planner prompts")
  .option("--unsafe", "Disable sandbox auto-detection")
  .action(withConfig(runBuild))

program
  .command("rewind <build-name>")
  .description("Reset pipeline state to a given stage and clean up downstream artifacts")
  .requiredOption("--to <stage>", "Stage to rewind to (shape, spec, plan)")
  .action((buildName: string, opts: Opts) => {
    try {
      runRewind(buildName, opts.to as string)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command("clean")
  .description("Remove all build worktrees and WIP branches")
  .action(() => {
    try {
      const { runClean } = require("./commands/clean")
      runClean(process.cwd())
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program.parse()
