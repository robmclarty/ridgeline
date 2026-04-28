#!/usr/bin/env node

import * as path from "node:path"
import { Command, Option } from "commander"
import { loadVersion, resolveConfig } from "./config"
import { resolveModel, resolveSpecialistTimeoutSeconds, resolveDirectionCount } from "./stores/settings"
import { RidgelineConfig } from "./types"
import { disableLogger } from "./ui/logger"
import { askBuildName } from "./ui/prompt"
import { runShape } from "./commands/shape"
import { runDesign } from "./commands/design"
import { runDirections } from "./commands/directions"
import { runSpec } from "./commands/spec"
import { runIngest } from "./commands/ingest"
import { runPlan } from "./commands/plan"
import { runDryRun } from "./commands/dry-run"
import { runBuild } from "./commands/build"
import { runCreate } from "./commands/create"
import { runRewind } from "./commands/rewind"
import { runRetrospective } from "./commands/retrospective"
import { runResearch } from "./commands/research"
import { runRefine } from "./commands/refine"
import { runCatalog } from "./commands/catalog"
import { runUi, DEFAULT_PORT as UI_DEFAULT_PORT } from "./commands/ui"
import { killAllClaude, killAllClaudeSync } from "./engine/claude/claude.exec"
import { enforceFlavourRemoved } from "./utils/flavour-removed"
import { detect } from "./engine/detect"
import { runPreflight, type StablePromptInfo } from "./ui/preflight"
import { probeSensorsUnderSandbox, formatProbeAbortMessage } from "./ui/preflight.toolprobe"
import { detectSandbox } from "./engine/claude/sandbox"
import { resolveStablePrompt } from "./engine/pipeline/pipeline.shared"
import { approximateTokenCount } from "./engine/claude/stable.prompt"

enforceFlavourRemoved(process.argv.slice(2))

// Deprecation pre-check: --deep-ensemble is renamed to --thorough.
// --thorough is now an alias for --specialists 3 (the default).
// Emit on every run (not once per session) so the user always sees it.
{
  const rawArgs = process.argv.slice(2)
  const hasDeep = rawArgs.includes("--deep-ensemble")
  if (hasDeep) {
    console.error("[deprecated] --deep-ensemble is now --specialists 3 (default); continuing")
  }
  const hasUnsafe = rawArgs.includes("--unsafe")
  if (hasUnsafe) {
    console.error("[deprecated] --unsafe is now --sandbox=off; continuing")
  }
}

// Kill all Claude subprocesses on Ctrl+C before exiting
process.on("SIGINT", () => {
  killAllClaude()
  setTimeout(() => process.exit(130), 2500)
})

// Kill Claude subprocesses on unhandled errors before crashing
process.on("uncaughtException", (err) => {
  killAllClaudeSync()
  console.error("Fatal error:", err.message)
  process.exit(1)
})

process.on("unhandledRejection", (reason) => {
  killAllClaudeSync()
  console.error(
    "Unhandled rejection:",
    reason instanceof Error ? reason.message : String(reason),
  )
  process.exit(1)
})

// Belt-and-suspenders: clean up any remaining subprocesses on exit
process.on("exit", () => {
  killAllClaudeSync()
})

type Opts = Record<string, string | boolean | undefined>

const requireBuildName = async (buildName: string | undefined): Promise<string> => {
  if (!buildName) buildName = await askBuildName()
  if (!buildName) {
    console.error("Build name is required")
    process.exit(1)
  }
  return buildName
}

const handleCommandError = (err: unknown): never => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

const ridgelineDirFromCwd = (): string => path.join(process.cwd(), ".ridgeline")

const detectPreflightFlags = (): { specialistCount: 1 | 2 | 3; isYes: boolean } => {
  const argv = process.argv.slice(2)
  // --thorough / --deep-ensemble are aliases for --specialists 3 (now the default)
  const specialistsFlag = argv.indexOf("--specialists")
  const explicit = specialistsFlag !== -1 ? parseInt(argv[specialistsFlag + 1] ?? "", 10) : NaN
  const specialistCount: 1 | 2 | 3 = explicit === 1 || explicit === 2 || explicit === 3
    ? explicit
    : 3
  return {
    specialistCount,
    isYes: argv.includes("--yes") || argv.includes("-y"),
  }
}

const stablePromptInfoFromConfig = (config: RidgelineConfig): StablePromptInfo | undefined => {
  try {
    const content = resolveStablePrompt(config)
    if (!content) return undefined
    return { tokens: approximateTokenCount(content), model: config.model }
  } catch {
    return undefined
  }
}

const runPreflightGuard = async (config?: RidgelineConfig): Promise<void> => {
  const { specialistCount, isYes } = detectPreflightFlags()
  const report = await detect(process.cwd(), { specialistCount })
  await runPreflight(report, {
    yes: isYes,
    isTTY: Boolean(process.stdin.isTTY),
    stablePromptInfo: config ? stablePromptInfoFromConfig(config) : undefined,
  })

  // Probe required binary tools under the active sandbox before any phase
  // burns budget. Only runs when invoked with a config (i.e., for build/plan/
  // dry-run paths) and when there are sensors that need real binaries.
  if (!config) return
  if (config.sandboxMode === "off") return
  if (report.suggestedSensors.length === 0) return

  const { provider } = detectSandbox(config.sandboxMode)
  const probeResults = await probeSensorsUnderSandbox(report.suggestedSensors, {
    cwd: process.cwd(),
    sandboxProvider: provider,
    sandboxMode: config.sandboxMode,
    sandboxExtras: config.sandboxExtras,
  })
  const failures = probeResults.filter((r) => !r.isLaunchable)
  if (failures.length > 0) {
    process.stderr.write(formatProbeAbortMessage(failures))
    process.exit(1)
  }
}

const addPreflightOptions = (cmd: Command): Command => cmd
  .option("--specialists <n>", "Number of ensemble specialists (1, 2, or 3). Default: 3")
  .option("--thorough", "Alias for --specialists 3 (the default)")
  .option("-y, --yes", "Skip the preflight confirmation prompt")

const parseBaseOpts = (opts: Opts) => ({
  model: resolveModel(opts.model as string | undefined, ridgelineDirFromCwd()),
  timeout: parseInt(String(opts.timeout ?? "10"), 10),
})

const invokeWithConfig = async (
  buildName: string | undefined,
  opts: Opts,
  withPreflight: boolean,
  fn: (config: RidgelineConfig) => Promise<void>,
): Promise<void> => {
  try {
    if (opts.structuredLog === false) disableLogger()
    const config = resolveConfig(await requireBuildName(buildName), opts)
    if (withPreflight) await runPreflightGuard(config)
    await fn(config)
  } catch (err) {
    handleCommandError(err)
  }
}

const withConfig = (fn: (config: RidgelineConfig) => Promise<void>) =>
  (buildName: string | undefined, opts: Opts) => invokeWithConfig(buildName, opts, false, fn)

const withConfigAndPreflight = (fn: (config: RidgelineConfig) => Promise<void>) =>
  (buildName: string | undefined, opts: Opts) => invokeWithConfig(buildName, opts, true, fn)

const program = new Command()

program
  .name("ridgeline")
  .description("Build harness for long-horizon software execution")
  .version(loadVersion())

// Default command: `ridgeline <build-name> [input]`
// Dispatches to the next incomplete pipeline stage
addPreflightOptions(program
  .argument("[build-name]", "Build name")
  .argument("[input]", "Description text or path to input file")
  .option("--model <name>", "Model for all stages (defaults to settings.json model, or 'opus')")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10")
  .option("--max-budget-usd <n>", "Halt if cumulative cost exceeds this amount")
  .option("--max-retries <n>", "Max reviewer retry loops per phase", "2")
  .option("--check <command>", "Baseline check command (overrides constraints.md)")
  .option("--check-timeout <seconds>", "Max duration for check command in seconds", "1200")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .option("--context <text>", "Extra context appended to builder and planner prompts")
  .option("--sandbox <mode>", "Sandbox mode: off | semi-locked (default) | strict")
  .option("--unsafe", "Alias for --sandbox=off (deprecated)"))
  .action(async (buildName: string | undefined, input: string | undefined, opts: Opts) => {
    try {
      await runPreflightGuard()
      await runCreate(await requireBuildName(buildName), {
        model: resolveModel(opts.model as string | undefined, ridgelineDirFromCwd()),
        timeout: String(opts.timeout ?? "10"),
        maxBudgetUsd: opts.maxBudgetUsd as string | undefined,
        maxRetries: opts.maxRetries as string | undefined,
        check: opts.check as string | undefined,
        checkTimeout: opts.checkTimeout as string | undefined,
        constraints: opts.constraints as string | undefined,
        taste: opts.taste as string | undefined,
        context: opts.context as string | undefined,
        unsafe: opts.unsafe === true,
        sandbox: opts.sandbox as string | undefined,
        input,
      })
    } catch (err) {
      handleCommandError(err)
    }
  })

addPreflightOptions(program
  .command("shape [build-name] [input]")
  .description("Gather project context and produce shape.md")
  .option("--model <name>", "Model for shaper agent (defaults to settings.json model, or 'opus')")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10"))
  .action(async (buildName: string | undefined, input: string | undefined, opts: Opts) => {
    try {
      await runPreflightGuard()
      await runShape(await requireBuildName(buildName), {
        model: resolveModel(opts.model as string | undefined, ridgelineDirFromCwd()),
        timeout: parseInt(String(opts.timeout ?? "10"), 10),
        input,
      })
    } catch (err) {
      handleCommandError(err)
    }
  })

program
  .command("directions [build-name]")
  .description(
    "Generate 2-3 differentiated visual direction options (HTML demos) before " +
      "design.md Q&A. Opt-in. Web-visual shapes only. Costs ~$2-5 per run.",
  )
  .option("--model <name>", "Model for direction-advisor agent (defaults to settings.json model, or 'opus')")
  .option("--timeout <minutes>", "Max duration in minutes", "15")
  .option("--count <n>", "Number of directions to generate (2 or 3). Overrides settings.directions.count")
  .option("--thorough", "Alias for --count 3")
  .option("--skip", "Explicit no-op (skip direction generation)")
  .option("-y, --yes", "Skip the preflight confirmation prompt")
  .action(async (buildName: string | undefined, opts: Opts) => {
    try {
      await runPreflightGuard()
      const cliOverride = opts.thorough === true
        ? 3
        : opts.count !== undefined ? parseInt(String(opts.count), 10) : undefined
      const count = resolveDirectionCount(ridgelineDirFromCwd(), cliOverride)
      await runDirections(await requireBuildName(buildName), {
        ...parseBaseOpts(opts),
        count,
        isSkip: opts.skip === true,
      })
    } catch (err) {
      handleCommandError(err)
    }
  })

addPreflightOptions(program
  .command("design [build-name]")
  .description("Establish or update visual design system (design.md)")
  .option("--model <name>", "Model for designer agent (defaults to settings.json model, or 'opus')")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10"))
  .action(async (buildName: string | undefined, opts: Opts) => {
    try {
      await runPreflightGuard()
      await runDesign(buildName ? await requireBuildName(buildName) : null, parseBaseOpts(opts))
    } catch (err) {
      handleCommandError(err)
    }
  })

addPreflightOptions(program
  .command("spec [build-name] [input]")
  .description(
    "Generate spec.md, constraints.md, and taste.md from shape.md via ensemble. " +
      "Optionally pass an input: path to a file (convention: idea.md) or raw text " +
      "treated as authoritative source material the synthesizer preserves alongside shape.md.",
  )
  .option("--model <name>", "Model for specialists and synthesizer (defaults to settings.json model, or 'opus')")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10")
  .option("--max-budget-usd <n>", "Halt if cumulative cost exceeds this amount"))
  .action(async (buildName: string | undefined, input: string | undefined, opts: Opts) => {
    try {
      await runPreflightGuard()
      const { specialistCount } = detectPreflightFlags()
      const ridgelineDir = ridgelineDirFromCwd()
      await runSpec(await requireBuildName(buildName), {
        model: resolveModel(opts.model as string | undefined, ridgelineDir),
        timeout: parseInt(String(opts.timeout ?? "10"), 10),
        maxBudgetUsd: opts.maxBudgetUsd ? parseFloat(String(opts.maxBudgetUsd)) : undefined,
        input,
        specialistCount,
        specialistTimeoutSeconds: resolveSpecialistTimeoutSeconds(ridgelineDir),
      })
    } catch (err) {
      handleCommandError(err)
    }
  })

addPreflightOptions(program
  .command("ingest [build-name] [input]")
  .description(
    "One-shot pipeline kickoff: convert a freeform spec (file or directory of " +
      "files) into shape.md, spec.md, constraints.md, taste.md (and design.md " +
      "if visual). No Q&A — the synthesizer flags inferred facts in a " +
      "`## Inferred / Gaps` section per file so you can edit them by hand " +
      "before running plan.",
  )
  .option("--model <name>", "Model for shaper, designer, and specifier (defaults to settings.json model, or 'opus')")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10")
  .option("--max-budget-usd <n>", "Halt if cumulative cost exceeds this amount"))
  .action(async (buildName: string | undefined, input: string | undefined, opts: Opts) => {
    try {
      await runPreflightGuard()
      if (!input) {
        console.error("ingest requires an input path (file or directory) or raw text")
        process.exit(1)
      }
      const { specialistCount } = detectPreflightFlags()
      await runIngest(await requireBuildName(buildName), {
        model: resolveModel(opts.model as string | undefined, ridgelineDirFromCwd()),
        timeout: parseInt(String(opts.timeout ?? "10"), 10),
        maxBudgetUsd: opts.maxBudgetUsd ? parseFloat(String(opts.maxBudgetUsd)) : undefined,
        specialistCount,
        input,
      })
    } catch (err) {
      handleCommandError(err)
    }
  })

addPreflightOptions(program
  .command("research [build-name]")
  .description("Research the spec using web sources to find improvements (optional step between spec and plan)")
  .option("--model <name>", "Model for research agents (defaults to settings.json model, or 'opus')")
  .option("--timeout <minutes>", "Max duration per agent in minutes", "15")
  .option("--max-budget-usd <n>", "Halt if cumulative research cost exceeds this amount")
  .option("--quick", "Run a single random specialist instead of the full ensemble")
  .option("--auto [iterations]", "Auto-loop: research + refine for N iterations (default 2)"))
  .action(async (buildName: string | undefined, opts: Opts) => {
    try {
      await runPreflightGuard()
      const autoRaw = opts.auto
      let auto: number | null = null
      if (autoRaw !== undefined) {
        auto = autoRaw === true ? 2 : parseInt(String(autoRaw), 10)
        if (isNaN(auto) || auto < 1) auto = 2
      }

      const { specialistCount } = detectPreflightFlags()
      const ridgelineDir = ridgelineDirFromCwd()
      await runResearch(await requireBuildName(buildName), {
        model: resolveModel(opts.model as string | undefined, ridgelineDir),
        timeout: parseInt(String(opts.timeout ?? "15"), 10),
        maxBudgetUsd: opts.maxBudgetUsd ? parseFloat(String(opts.maxBudgetUsd)) : undefined,
        isQuick: opts.quick === true,
        auto,
        specialistCount,
        specialistTimeoutSeconds: resolveSpecialistTimeoutSeconds(ridgelineDir),
      })
    } catch (err) {
      handleCommandError(err)
    }
  })

addPreflightOptions(program
  .command("refine [build-name]")
  .description("Merge research.md findings into spec.md")
  .option("--model <name>", "Model for refiner agent (defaults to settings.json model, or 'opus')")
  .option("--timeout <minutes>", "Max duration in minutes", "10"))
  .action(async (buildName: string | undefined, opts: Opts) => {
    try {
      await runPreflightGuard()
      await runRefine(await requireBuildName(buildName), parseBaseOpts(opts))
    } catch (err) {
      handleCommandError(err)
    }
  })

program
  .command("catalog [build-name]")
  .description("Catalog media assets into asset-catalog.json")
  .option("--asset-dir <path>", "Path to asset directory")
  .option("--describe", "Add vision-based descriptions for all assets")
  .option("--classify", "AI-classify uncategorized files into categories")
  .option("--force", "Re-process all assets ignoring content hash")
  .option("--pack", "Generate sprite atlases after cataloging")
  .option("--batch", "Batch multiple images per vision call")
  .option("--model <name>", "Model for vision and classification (defaults to settings.json model, or 'opus')")
  .option("--timeout <minutes>", "Max duration per AI call in minutes", "5")
  .action(async (buildName: string | undefined, opts: Opts) => {
    try {
      await runCatalog(await requireBuildName(buildName), {
        assetDir: opts.assetDir as string | undefined,
        isDescribe: opts.describe === true,
        isClassify: opts.classify === true,
        isForce: opts.force === true,
        isPack: opts.pack === true,
        isBatch: opts.batch === true,
        model: resolveModel(opts.model as string | undefined, ridgelineDirFromCwd()),
        timeout: parseInt(String(opts.timeout ?? "5"), 10),
      })
    } catch (err) {
      handleCommandError(err)
    }
  })

const addPlanOptions = (cmd: Command): Command => cmd
  .option("--model <name>", "Model for planner (defaults to settings.json model, or 'opus')")
  .option("--timeout <minutes>", "Max duration for planning", "120")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .addOption(new Option("--deep-ensemble", "deprecated: use --thorough").hideHelp())

addPreflightOptions(addPlanOptions(program
  .command("plan [build-name]")
  .description("Generate phase specs from spec.md and constraints.md")))
  .action(withConfigAndPreflight(runPlan))

addPlanOptions(program
  .command("dry-run [build-name]")
  .description("Display the plan without executing"))
  .action(withConfig(runDryRun))

addPreflightOptions(program
  .command("build [build-name]")
  .description("Execute the build pipeline (automatically resumes from last successful phase)")
  .option("--timeout <minutes>", "Max duration per phase in minutes", "120")
  .option("--check-timeout <seconds>", "Max duration for check command in seconds", "1200")
  .option("--max-retries <n>", "Max reviewer retry loops per phase", "2")
  .option("--check <command>", "Baseline check command (overrides constraints.md)")
  .option("--model <name>", "Model for builder and reviewer (defaults to settings.json model, or 'opus')")
  .option("--max-budget-usd <n>", "Halt if cumulative cost exceeds this amount")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .option("--context <text>", "Extra context appended to builder and planner prompts")
  .option("--sandbox <mode>", "Sandbox mode: off | semi-locked (default) | strict")
  .option("--unsafe", "Alias for --sandbox=off (deprecated)")
  .option("--no-structured-log", "Disable structured logging to log.jsonl"))
  .action(withConfigAndPreflight(runBuild))

addPreflightOptions(program
  .command("rewind <build-name>")
  .description("Reset pipeline state to a given stage and clean up downstream artifacts")
  .requiredOption("--to <stage>", "Stage to rewind to (shape, spec, research, refine, plan)"))
  .action(async (buildName: string, opts: Opts) => {
    try {
      await runPreflightGuard()
      runRewind(buildName, opts.to as string)
    } catch (err) {
      handleCommandError(err)
    }
  })

addPreflightOptions(program
  .command("retrospective [build-name]")
  .description("Analyze a completed build and extract learnings for future builds")
  .option("--model <name>", "Model for retrospective agent (defaults to settings.json model, or 'opus')")
  .option("--timeout <minutes>", "Max duration in minutes", "10"))
  .action(async (buildName: string | undefined, opts: Opts) => {
    try {
      await runPreflightGuard()
      await runRetrospective(await requireBuildName(buildName), {
        model: resolveModel(opts.model as string | undefined, ridgelineDirFromCwd()),
        timeout: parseInt(String(opts.timeout ?? "10"), 10),
      })
    } catch (err) {
      handleCommandError(err)
    }
  })

program
  .command("clean")
  .description("Clean up build artifacts")
  .action(() => {
    try {
      const { runClean } = require("./commands/clean")
      runClean(process.cwd())
    } catch (err) {
      handleCommandError(err)
    }
  })

program
  .command("ui [build-name]")
  .description("Open a localhost dashboard for monitoring a build")
  .option("--port <number>", "Port to bind (default 4411, falls back to next free port if taken)")
  .action(async (buildName: string | undefined, opts: Opts) => {
    try {
      const portRaw = opts.port as string | undefined
      const port = portRaw ? parseInt(String(portRaw), 10) : UI_DEFAULT_PORT
      const server = await runUi(process.cwd(), buildName, {
        port: isNaN(port) ? UI_DEFAULT_PORT : port,
      })
      const shutdown = async (): Promise<void> => {
        await server.close()
        process.exit(0)
      }
      process.on("SIGINT", shutdown)
      process.on("SIGTERM", shutdown)
    } catch (err) {
      handleCommandError(err)
    }
  })

program
  .command("check")
  .description("Check project prerequisites and tooling")
  .action(() => {
    try {
      const { runCheck } = require("./commands/check")
      runCheck()
    } catch (err) {
      handleCommandError(err)
    }
  })

program.parse()
