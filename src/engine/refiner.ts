import * as fs from "node:fs"
import * as path from "node:path"
import type { Engine } from "fascicle"
import { ClaudeResult } from "../types.js"
import { runClaudeProcess } from "./claude-process.js"
import { runClaudeOneShot } from "./claude.runner.js"
import { resolveRoute } from "./provider-route.js"
import { createLegacyStdoutDisplay, createStreamDisplay } from "../ui/claude-stream-display.js"
import { buildAgentRegistry } from "./discovery/agent.registry.js"
import { createStderrHandler } from "./legacy-shared.js"
import { SYNTHESIZER_STALL_TIMEOUT_MS } from "./ensemble.js"
import { createPromptDocument } from "./prompt-document.js"
import { shapeRefinerModelCallInput, type RefinerArgs } from "./atoms/refiner.atom.js"
import { buildToolSurface } from "./tools/factory.js"
import { nonSandboxedToolContext } from "./engine-inputs.js"

// ---------------------------------------------------------------------------
// Refine executor
// ---------------------------------------------------------------------------

const ENGINE_REFINER_MAX_STEPS = 8

export type RefineConfig = {
  model: string
  ridgelineDir: string
  timeoutMinutes: number
  buildDir: string
  changelogMd: string | null
  iterationNumber: number
}

/** Spawn-path refiner (Claude CLI). Byte-stable; unchanged. */
const runRefinerViaSpawn = async (
  specMd: string,
  researchMd: string,
  constraintsMd: string,
  tasteMd: string | null,
  config: RefineConfig,
): Promise<ClaudeResult> => {
  const registry = buildAgentRegistry()
  const systemPrompt = registry.getCorePrompt("refiner.md")

  const doc = createPromptDocument()

  doc.data("spec.md", specMd)
  doc.data("research.md", researchMd)

  if (config.changelogMd) {
    doc.data("spec.changelog.md (your prior changes)", config.changelogMd)
  }

  doc.data("constraints.md", constraintsMd)
  if (tasteMd) {
    doc.data("taste.md", tasteMd)
  }

  doc.instruction(
    "Output",
    `1. Rewrite the spec incorporating research findings. Write the revised spec to: ${config.buildDir}/spec.md\n` +
    `2. Document your changes. Write the changelog to: ${config.buildDir}/spec.changelog.md\n` +
    `   - ${config.changelogMd ? "Read the existing spec.changelog.md first, then prepend" : "Create"} a new ## Iteration ${config.iterationNumber} section.\n` +
    "Use the Write tool for both files.",
  )

  const userPrompt = doc.render()
  const { onStdout, flush } = createLegacyStdoutDisplay({ projectRoot: process.cwd() })
  try {
    return await runClaudeProcess({
      systemPrompt,
      userPrompt,
      model: config.model,
      allowedTools: ["Read", "Write"],
      cwd: process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      stallTimeoutMs: SYNTHESIZER_STALL_TIMEOUT_MS,
      onStdout,
      onStderr: createStderrHandler("refiner"),
    })
  } finally {
    flush()
  }
}

/** Engine-path refiner (AI-SDK providers): in-process Read/Write tool loop. */
const runRefinerViaEngine = async (
  specMd: string,
  researchMd: string,
  constraintsMd: string,
  tasteMd: string | null,
  config: RefineConfig,
  engine: Engine,
): Promise<ClaudeResult> => {
  const registry = buildAgentRegistry()
  const roleSystem = registry.getCorePrompt("refiner.md")
  const args: RefinerArgs = {
    specMd,
    researchMd,
    constraintsMd,
    tasteMd,
    changelogMd: config.changelogMd,
    buildDir: config.buildDir,
    iterationNumber: config.iterationNumber,
  }
  const tools = buildToolSurface(
    "refiner",
    nonSandboxedToolContext(process.cwd(), [config.buildDir]),
  )
  const { onChunk, flush } = createStreamDisplay({ projectRoot: process.cwd() })
  const wallStart = Date.now()
  try {
    const result = await runClaudeOneShot({
      engine,
      model: config.model,
      system: roleSystem,
      prompt: shapeRefinerModelCallInput(args),
      tools,
      maxSteps: ENGINE_REFINER_MAX_STEPS,
      toolErrorPolicy: "feed_back",
      onChunk,
      timeoutMs: config.timeoutMinutes * 60 * 1000,
    })
    if (result.durationMs === 0) result.durationMs = Date.now() - wallStart
    return result
  } finally {
    flush()
  }
}

/**
 * Rewrite the spec from research findings. Claude (claude_cli) runs the
 * byte-stable spawn path; any other provider runs the in-process engine path
 * (passed `engine`). Both must leave spec.md + spec.changelog.md on disk.
 */
export const runRefiner = async (
  specMd: string,
  researchMd: string,
  constraintsMd: string,
  tasteMd: string | null,
  config: RefineConfig,
  engine?: Engine,
): Promise<ClaudeResult> => {
  const route = resolveRoute(config.model, config.ridgelineDir)
  const result =
    !route.isClaudeCli && engine
      ? await runRefinerViaEngine(specMd, researchMd, constraintsMd, tasteMd, config, engine)
      : await runRefinerViaSpawn(specMd, researchMd, constraintsMd, tasteMd, config)

  if (!fs.existsSync(path.join(config.buildDir, "spec.md"))) {
    throw new Error("Refiner did not write spec.md")
  }
  if (!fs.existsSync(path.join(config.buildDir, "spec.changelog.md"))) {
    throw new Error("Refiner did not write spec.changelog.md")
  }

  return result
}
