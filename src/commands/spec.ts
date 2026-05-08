import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import { run } from "fascicle"
import { printInfo, printError } from "../ui/output.js"
import { runSpecifyEnsemble, type SpecEnsembleConfig } from "../engine/specifier.js"
import { advancePipeline, getMatchedShapes } from "../stores/state.js"
import {
  DEFAULT_SPECIALIST_TIMEOUT_SECONDS,
  DEFAULT_SPECIALIST_COUNT,
  resolveSandboxMode,
} from "../stores/settings.js"
import { resolveInput } from "./input.js"
import { askQuestion } from "./qa-workflow.js"
import { makeRidgelineEngine } from "../engine/engine.factory.js"
import { specFlow, type SpecFlowInput } from "../engine/flows/spec.flow.js"

export type SpecOptions = {
  model: string
  timeout: number
  maxBudgetUsd?: number
  /** Optional path to a file (e.g., idea.md) or raw text to feed as authoritative spec guidance. */
  input?: string
  specialistCount?: 1 | 2 | 3
  specialistTimeoutSeconds?: number
  /**
   * Pre-resolved authoritative spec content. When provided, takes precedence
   * over `input` (skips disk read and the file-vs-text heuristic). Used by
   * the `ingest` command to pass an already-resolved bundle through.
   */
  inputContent?: string
  /** When true, instruct the synthesizer to add `## Inferred / Gaps` sections. */
  inferGapFlagging?: boolean
}

/**
 * Files the specifier will write. Used to detect existing output the user
 * might not want clobbered.
 */
const SPEC_OUTPUT_FILES = ["spec.md", "constraints.md", "taste.md"] as const

/**
 * Prompt the user to confirm overwriting existing spec output. Returns true
 * to proceed, false to abort. If stdin isn't a TTY (CI, pipes, tests with no
 * readline mock), defaults to aborting — destroying data without consent is
 * the wrong default.
 */
const confirmOverwrite = async (existing: string[]): Promise<boolean> => {
  const isTty = Boolean(process.stdin.isTTY)
  if (!isTty) {
    printError(
      `Existing files would be overwritten: ${existing.join(", ")}. ` +
        `Refusing to proceed in a non-interactive session. Move or delete them, or run 'ridgeline rewind' first.`,
    )
    return false
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log("")
    printInfo(`The following files will be overwritten: ${existing.join(", ")}`)
    const answer = await askQuestion(rl, "Continue and overwrite? [y/N] ")
    return /^y(es)?$/i.test(answer)
  } finally {
    rl.close()
  }
}

export const runSpec = async (buildName: string, opts: SpecOptions): Promise<void> => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = path.join(ridgelineDir, "builds", buildName)

  // Verify shape.md exists
  const shapePath = path.join(buildDir, "shape.md")
  if (!fs.existsSync(shapePath)) {
    printError(`shape.md not found at ${shapePath}`)
    printError(`Run 'ridgeline shape ${buildName}' first`)
    return
  }

  const shapeMd = fs.readFileSync(shapePath, "utf-8")

  // Resolve optional user input (raw text or file path).
  // `inputContent` takes precedence — it's a pre-resolved bundle from ingest.
  let userInput: string | null = null
  if (opts.inputContent !== undefined) {
    userInput = opts.inputContent
    printInfo("Using spec input from: pre-resolved bundle")
  } else if (opts.input) {
    const resolved = resolveInput(opts.input)
    if (resolved.type === "file") {
      printInfo(`Using spec input from: ${resolved.path}`)
    } else {
      printInfo("Using spec input from: inline text")
    }
    userInput = resolved.content
  }

  // Warn before destroying existing spec output
  const existing = SPEC_OUTPUT_FILES.filter((f) => fs.existsSync(path.join(buildDir, f)))
  if (existing.length > 0) {
    const proceed = await confirmOverwrite([...existing])
    if (!proceed) {
      printInfo("Aborted. No files were modified.")
      return
    }
  }

  const engine = makeRidgelineEngine({
    sandboxFlag: resolveSandboxMode(ridgelineDir, undefined),
    timeoutMinutes: opts.timeout,
    pluginDirs: [],
    settingSources: ["user", "project", "local"],
    buildPath: buildDir,
  })

  const flow = specFlow({
    executor: async (input: SpecFlowInput) => {
      const config: SpecEnsembleConfig = {
        model: opts.model,
        timeoutMinutes: opts.timeout,
        specialistTimeoutSeconds: opts.specialistTimeoutSeconds ?? DEFAULT_SPECIALIST_TIMEOUT_SECONDS,
        maxBudgetUsd: opts.maxBudgetUsd ?? null,
        buildDir: input.buildDir,
        matchedShapes: getMatchedShapes(input.buildDir),
        specialistCount: opts.specialistCount ?? DEFAULT_SPECIALIST_COUNT,
        userInput,
        inferGapFlagging: opts.inferGapFlagging,
      }
      return runSpecifyEnsemble(input.shapeMd, config)
    },
  })

  let result
  try {
    const out = await run(flow, { shapeMd, buildDir, buildName }, { install_signal_handlers: false })
    result = out.ensemble
  } finally {
    await engine.dispose()
  }

  // Update pipeline state
  advancePipeline(buildDir, buildName, "spec")

  // Report created files
  console.log("")
  const createdFiles = ["spec.md", "constraints.md", "taste.md"]
    .filter((f) => fs.existsSync(path.join(buildDir, f)))

  printInfo("Created:")
  for (const f of createdFiles) {
    console.log(`  ${path.join(buildDir, f)}`)
  }

  if (!createdFiles.includes("taste.md")) {
    printInfo("Note: taste.md was not created (no style preferences in shape)")
  }

  console.log("")
  printInfo(`Spec ensemble: ${result.specialistResults.length} specialists + synthesizer`)
  printInfo(`Total cost: $${result.totalCostUsd.toFixed(2)}`)
  console.log("")
  printInfo(`Next: ridgeline plan ${buildName}`)
}
