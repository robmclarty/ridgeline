#!/usr/bin/env node

import * as path from "node:path"
import { Command, Option } from "commander"
import { loadVersion, resolveConfig } from "./config.js"
import { resolveModel, resolveSpecialistTimeoutSeconds, resolveDirectionCount } from "./stores/settings.js"
import { RidgelineConfig } from "./types.js"
import { disableLogger } from "./ui/logger.js"
import { askBuildName } from "./ui/prompt.js"
import { runShape, runShapeAuto } from "./commands/shape.js"
import { runDesign, runDesignAuto } from "./commands/design.js"
import { runDirections, runDirectionsAuto } from "./commands/directions.js"
import { runSpec } from "./commands/spec.js"
import { runIngest } from "./commands/ingest.js"
import { runPlan } from "./commands/plan.js"
import { runDryRun } from "./commands/dry-run.js"
import { runBuild } from "./commands/build.js"
import { runCreate } from "./commands/create.js"
import { runAuto, StopAfter } from "./commands/auto.js"
import { runRewind } from "./commands/rewind.js"
import { runRetrospective } from "./commands/retrospective.js"
import { runRetroRefine } from "./commands/retro-refine.js"
import { runResearch } from "./commands/research.js"
import { runRefine } from "./commands/refine.js"
import { runCatalog } from "./commands/catalog.js"
import { runUi, DEFAULT_PORT as UI_DEFAULT_PORT } from "./commands/ui.js"
import { resolveInputBundle } from "./commands/input.js"
import { resolveNameAndInput, parseAutoCount } from "./utils/cli-args.js"
import { killAllClaudeSync } from "./engine/claude-process.js"
import { enforceFlavourRemoved } from "./utils/flavour-removed.js"
import { detect } from "./engine/detect/index.js"
import { runPreflight, type StablePromptInfo } from "./ui/preflight.js"
import { probeSensorsUnderSandbox, formatProbeAbortMessage } from "./ui/preflight.toolprobe.js"
import { detectSandbox } from "./engine/claude/sandbox.js"
import { resolveStablePrompt } from "./engine/legacy-shared.js"
import { approximateTokenCount } from "./engine/claude/stable.prompt.js"

const isMainModule = (): boolean => {
  const argv1 = process.argv[1]
  if (!argv1) return false
  return argv1.endsWith("/main.js") || argv1.endsWith("/main.ts")
}

if (isMainModule()) {
  enforceFlavourRemoved(process.argv.slice(2))

  // Deprecation pre-check: --deep-ensemble is renamed to --thorough.
  // --thorough is now an alias for --specialists 3 (the default).
  // Emit on every run (not once per session) so the user always sees it.
  const rawArgs = process.argv.slice(2)
  if (rawArgs.includes("--deep-ensemble")) {
    console.error("[deprecated] --deep-ensemble is now --specialists 3 (default); continuing")
  }
  if (rawArgs.includes("--unsafe")) {
    console.error("[deprecated] --unsafe is now --sandbox=off; continuing")
  }

  // SIGINT handover: fascicle's runner installs SIGINT/SIGTERM handlers via
  // install_signal_handlers (default true) and aborts active runs. Exit code
  // 130 is preserved by handleCommandError, which detects aborted_error.

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
}

type Opts = Record<string, string | boolean | undefined>

const requireBuildName = async (buildName: string | undefined): Promise<string> => {
  if (!buildName) buildName = await askBuildName()
  if (!buildName) {
    console.error("Build name is required")
    process.exit(1)
  }
  return buildName
}

const isAbortedError = (err: unknown): boolean => {
  if (err === null || typeof err !== "object") return false
  const kind = (err as { kind?: unknown }).kind
  if (kind === "aborted_error") return true
  const name = (err as { name?: unknown }).name
  return name === "aborted_error"
}

const registerProcessSignal = (
  signal: NodeJS.Signals,
  handler: () => void | Promise<void>,
): void => {
  process.on(signal, handler)
}

const handleCommandError = (err: unknown): never => {
  if (isAbortedError(err)) {
    killAllClaudeSync()
    process.exit(130)
  }
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

/** Adds the uniform `--auto` flag to a subcommand. */
const addAutoOption = (cmd: Command): Command =>
  cmd.option("--auto", "Non-interactive mode: skip Q&A; use Auto variants where applicable")

/** Adds the orchestrator-only flags (default command). */
const addAutoOrchestratorOptions = (cmd: Command): Command => cmd
  .option("--stop-after <stage>", "Halt the auto run after this stage (shape|design|spec|plan|build)")
  .option("--no-refine", "Skip retro-refine at the end of an --auto run")
  .option("--research [n]", "Run N research+refine iterations between spec and plan (default 1)")
  .option("--directions [n]", "Generate N parallel directions between shape and design (default 3)")
  .option("--inspiration <src>", "Source for the directions picker: file path, directory, or inline text")

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
// Dispatches to the next incomplete pipeline stage. With --auto, runs the
// full orchestrator end-to-end.
addAutoOrchestratorOptions(addAutoOption(addPreflightOptions(program
  .argument("[build-name]", "Build name (or input path; build name derived from basename)")
  .argument("[input]", "Description text or path to input file/directory")
  .option("--model <name>", "Model for all stages (defaults to settings.json model, or 'cli-opus')")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10")
  .option("--max-budget-usd <n>", "Halt if cumulative cost exceeds this amount")
  .option("--max-retries <n>", "Max reviewer retry loops per phase", "2")
  .option("--check <command>", "Baseline check command (overrides constraints.md)")
  .option("--check-timeout <seconds>", "Max duration for check command in seconds", "1200")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .option("--context <text>", "Extra context appended to builder and planner prompts")
  .option("--sandbox <mode>", "Sandbox mode: off | semi-locked (default) | strict")
  .option("--unsafe", "Alias for --sandbox=off (deprecated)")
  .option("--require-phase-approval", "Pause between phases for explicit user confirmation before continuing"))))
  .action(async (arg1: string | undefined, arg2: string | undefined, opts: Opts) => {
    try {
      await runPreflightGuard()
      const { buildName, input } = resolveNameAndInput(arg1, arg2)
      const resolvedName = await requireBuildName(buildName)
      const { specialistCount } = detectPreflightFlags()

      const baseCreateOpts = {
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
        requirePhaseApproval: opts.requirePhaseApproval === true,
        input,
        specialistCount,
      }

      if (opts.auto === true) {
        await runAuto(resolvedName, {
          ...baseCreateOpts,
          stopAfter: opts.stopAfter as StopAfter | undefined,
          isNoRefine: opts.refine === false,
          research: parseAutoCount(opts.research, 1),
          directions: parseAutoCount(opts.directions, 3),
          inspiration: opts.inspiration as string | undefined,
        })
        return
      }

      await runCreate(resolvedName, baseCreateOpts)
    } catch (err) {
      handleCommandError(err)
    }
  })

addAutoOption(addPreflightOptions(program
  .command("shape [build-name] [input]")
  .description("Gather project context and produce shape.md")
  .option("--model <name>", "Model for shaper agent (defaults to settings.json model, or 'cli-opus')")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10")))
  .action(async (buildName: string | undefined, input: string | undefined, opts: Opts) => {
    try {
      await runPreflightGuard()
      const resolvedName = await requireBuildName(buildName)
      const baseOpts = {
        model: resolveModel(opts.model as string | undefined, ridgelineDirFromCwd()),
        timeout: parseInt(String(opts.timeout ?? "10"), 10),
        input,
      }
      if (opts.auto === true) {
        if (!input) {
          console.error("--auto requires an input argument for shape")
          process.exit(1)
        }
        const bundle = resolveInputBundle(input)
        await runShapeAuto(resolvedName, {
          ...baseOpts,
          inputContent: bundle.content,
          inputLabel: bundle.type === "file"
            ? bundle.path
            : bundle.type === "directory"
              ? `${bundle.path} (${bundle.files.length} files)`
              : "inline text",
        })
        return
      }
      await runShape(resolvedName, baseOpts)
    } catch (err) {
      handleCommandError(err)
    }
  })

addAutoOption(program
  .command("directions [build-name]")
  .description(
    "Generate differentiated visual direction options (HTML demos) before " +
      "design.md Q&A. Opt-in. Web-visual shapes only. With --auto, dispatches " +
      "N parallel design-specialists then picks one against --inspiration.",
  )
  .option("--model <name>", "Model for direction-advisor agent (defaults to settings.json model, or 'cli-opus')")
  .option("--timeout <minutes>", "Max duration in minutes", "15")
  .option("--count <n>", "Number of directions to generate. Overrides settings.directions.count")
  .option("--thorough", "Alias for --count 3")
  .option("--skip", "Explicit no-op (skip direction generation)")
  .option("--inspiration <src>", "Inspiration source for the auto picker: file path, directory, or inline text")
  .option("-y, --yes", "Skip the preflight confirmation prompt"))
  .action(async (buildName: string | undefined, opts: Opts) => {
    try {
      await runPreflightGuard()
      const cliOverride = opts.thorough === true
        ? 3
        : opts.count !== undefined ? parseInt(String(opts.count), 10) : undefined
      const count = resolveDirectionCount(ridgelineDirFromCwd(), cliOverride)
      const resolvedName = await requireBuildName(buildName)
      const baseOpts = {
        ...parseBaseOpts(opts),
        count,
        isSkip: opts.skip === true,
      }
      if (opts.auto === true) {
        await runDirectionsAuto(resolvedName, {
          ...baseOpts,
          inspiration: opts.inspiration as string | undefined,
        })
        return
      }
      await runDirections(resolvedName, baseOpts)
    } catch (err) {
      handleCommandError(err)
    }
  })

addAutoOption(addPreflightOptions(program
  .command("design [build-name]")
  .description("Establish or update visual design system (design.md)")
  .option("--model <name>", "Model for designer agent (defaults to settings.json model, or 'cli-opus')")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10")))
  .action(async (buildName: string | undefined, opts: Opts) => {
    try {
      await runPreflightGuard()
      const resolvedName = buildName ? await requireBuildName(buildName) : null
      if (opts.auto === true) {
        await runDesignAuto(resolvedName, { ...parseBaseOpts(opts), inferGapFlagging: true })
        return
      }
      await runDesign(resolvedName, parseBaseOpts(opts))
    } catch (err) {
      handleCommandError(err)
    }
  })

addAutoOption(addPreflightOptions(program
  .command("spec [build-name] [input]")
  .description(
    "Generate spec.md, constraints.md, and taste.md from shape.md via ensemble. " +
      "Optionally pass an input: path to a file (convention: idea.md) or raw text " +
      "treated as authoritative source material the synthesizer preserves alongside shape.md.",
  )
  .option("--model <name>", "Model for specialists and synthesizer (defaults to settings.json model, or 'cli-opus')")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10")
  .option("--max-budget-usd <n>", "Halt if cumulative cost exceeds this amount")))
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

addAutoOption(addPreflightOptions(program
  .command("ingest [build-name] [input]")
  .description(
    "One-shot pipeline kickoff: convert a freeform spec (file or directory of " +
      "files) into shape.md, spec.md, constraints.md, taste.md (and design.md " +
      "if visual). No Q&A — the synthesizer flags inferred facts in a " +
      "`## Inferred / Gaps` section per file so you can edit them by hand " +
      "before running plan.",
  )
  .option("--model <name>", "Model for shaper, designer, and specifier (defaults to settings.json model, or 'cli-opus')")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10")
  .option("--max-budget-usd <n>", "Halt if cumulative cost exceeds this amount")))
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
  .option("--model <name>", "Model for research agents (defaults to settings.json model, or 'cli-opus')")
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

addAutoOption(addPreflightOptions(program
  .command("refine [build-name]")
  .description("Merge research.md findings into spec.md")
  .option("--model <name>", "Model for refiner agent (defaults to settings.json model, or 'cli-opus')")
  .option("--timeout <minutes>", "Max duration in minutes", "10")))
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
  .option("--model <name>", "Model for vision and classification (defaults to settings.json model, or 'cli-opus')")
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
  .option("--model <name>", "Model for planner (defaults to settings.json model, or 'cli-opus')")
  .option("--timeout <minutes>", "Max duration for planning (or 'unlimited' for a 24h catchall)", "120")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .addOption(new Option("--deep-ensemble", "deprecated: use --thorough").hideHelp())

addAutoOption(addPreflightOptions(addPlanOptions(program
  .command("plan [build-name]")
  .description("Generate phase specs from spec.md and constraints.md"))))
  .action(withConfigAndPreflight(runPlan))

addPlanOptions(program
  .command("dry-run [build-name]")
  .description("Display the plan without executing"))
  .action(withConfig(runDryRun))

addAutoOption(addPreflightOptions(program
  .command("build [build-name]")
  .description("Execute the build pipeline (automatically resumes from last successful phase)")
  .option("--timeout <minutes>", "Max duration per phase in minutes (or 'unlimited' for a 24h catchall)", "120")
  .option("--require-phase-approval", "Pause between phases for explicit user confirmation before continuing")
  .option("--check-timeout <seconds>", "Max duration for check command in seconds", "1200")
  .option("--max-retries <n>", "Max reviewer retry loops per phase", "2")
  .option("--check <command>", "Baseline check command (overrides constraints.md)")
  .option("--model <name>", "Model for builder and reviewer (defaults to settings.json model, or 'cli-opus')")
  .option("--max-budget-usd <n>", "Halt if cumulative cost exceeds this amount")
  .option("--constraints <path>", "Path to constraints.md")
  .option("--taste <path>", "Path to taste.md")
  .option("--context <text>", "Extra context appended to builder and planner prompts")
  .option("--sandbox <mode>", "Sandbox mode: off | semi-locked (default) | strict")
  .option("--unsafe", "Alias for --sandbox=off (deprecated)")
  .option("--no-structured-log", "Disable structured logging to log.jsonl")))
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

addAutoOption(addPreflightOptions(program
  .command("retrospective [build-name]")
  .description("Analyze a completed build and extract learnings for future builds")
  .option("--model <name>", "Model for retrospective agent (defaults to settings.json model, or 'cli-opus')")
  .option("--timeout <minutes>", "Max duration in minutes", "10")))
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

addAutoOption(addPreflightOptions(program
  .command("retro-refine [build-name]")
  .description(
    "Produce a refined version of the original input spec from learnings.md " +
      "and the just-completed build's artifacts. Writes refined-input.md to " +
      "the build directory.",
  )
  .option("--model <name>", "Model for retro-refiner agent (defaults to settings.json model, or 'cli-opus')")
  .option("--timeout <minutes>", "Max duration in minutes", "10")))
  .action(async (buildName: string | undefined, opts: Opts) => {
    try {
      await runPreflightGuard()
      await runRetroRefine(await requireBuildName(buildName), {
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
  .action(async () => {
    try {
      const { runClean } = await import("./commands/clean.js")
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
      // The UI command runs a long-lived HTTP server, not a fascicle flow,
      // so its lifecycle is signal-driven (see commands/ui.ts.shutdown()).
      registerProcessSignal("SIGINT", shutdown)
      registerProcessSignal("SIGTERM", shutdown)
    } catch (err) {
      handleCommandError(err)
    }
  })

program
  .command("check")
  .description("Check project prerequisites and tooling")
  .action(async () => {
    try {
      const { runCheck } = await import("./commands/check.js")
      runCheck()
    } catch (err) {
      handleCommandError(err)
    }
  })

export { program }

if (isMainModule()) {
  program.parse()
}
