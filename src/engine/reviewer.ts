import * as fs from "node:fs"
import type { Engine } from "fascicle"
import { RidgelineConfig, PhaseInfo, ClaudeResult, ReviewVerdict } from "../types.js"
import type { SensorFinding } from "../sensors/index.js"
import { runClaudeProcess } from "./claude-process.js"
import { runClaudeOneShot } from "./claude.runner.js"
import { createLegacyStdoutDisplay, createStreamDisplay } from "../ui/claude-stream-display.js"
import { getDiff } from "../git.js"
import { parseVerdict } from "../stores/feedback.verdict.js"
import { cleanupPluginDirs } from "./discovery/plugin.scan.js"
import { buildAgentRegistry } from "./discovery/agent.registry.js"
import { prepareAgentsAndPlugins, commonInvokeOptions, appendDesign } from "./legacy-shared.js"
import { getMatchedShapes } from "../stores/state.js"
import { loadShapeDefinitions } from "../shapes/detect.js"
import { createPromptDocument } from "./prompt-document.js"
import { buildToolSurface } from "./tools/factory.js"
import { toolContextFromConfig } from "./engine-inputs.js"
import { reviewVerdictSchema } from "./schemas.js"

/** Tool-loop step cap for an engine reviewer (read-only investigation turns). */
const ENGINE_REVIEWER_MAX_STEPS = 12

const assembleUserPrompt = (
  config: RidgelineConfig,
  phase: PhaseInfo,
  checkpointTag: string,
  cwd?: string,
  sensorFindings?: SensorFinding[],
): string => {
  const doc = createPromptDocument()

  doc.data("Phase Spec", fs.readFileSync(phase.filepath, "utf-8"))

  const diff = getDiff(checkpointTag, cwd)
  if (diff) {
    doc.dataFenced("Git Diff (checkpoint to HEAD)", diff, "diff")
  } else {
    doc.data("Git Diff (checkpoint to HEAD)", "No changes detected.")
  }

  doc.data("constraints.md", fs.readFileSync(config.constraintsPath, "utf-8"))

  appendDesign(doc, config)

  if (sensorFindings && sensorFindings.length > 0) {
    const lines: string[] = []
    for (const finding of sensorFindings) {
      const pathPart = finding.path ? ` (${finding.path})` : ""
      lines.push(`- [${finding.severity}] ${finding.kind}: ${finding.summary}${pathPart}`)
    }
    doc.data("Sensor Findings (from builder loop)", lines.join("\n"))
  }

  // Inject reviewer context from matched shapes
  const matchedShapeNames = getMatchedShapes(config.buildDir)
  if (matchedShapeNames.length > 0) {
    const allDefs = loadShapeDefinitions()
    const matchedDefs = allDefs.filter((d) => matchedShapeNames.includes(d.name))

    if (matchedDefs.length > 0) {
      const lines: string[] = []
      lines.push("The following visual design heuristics apply to this phase:\n")
      for (const def of matchedDefs) {
        lines.push(`### ${def.name}\n`)
        lines.push(def.reviewerContext)
        lines.push("")
      }
      lines.push("**Review rules for design.md:**")
      lines.push("- Hard token violations (specific values with imperative language) → severity: blocking")
      lines.push("- Soft guidance deviations (directional language) → severity: suggestion")
      doc.instruction("Visual Design Review Context", lines.join("\n"))
    }
  }

  return doc.render()
}

/** Spawn-path reviewer (Claude CLI). Byte-stable; unchanged. */
const runReviewerViaSpawn = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  checkpointTag: string,
  cwd?: string,
  sensorFindings?: SensorFinding[],
): Promise<ClaudeResult> => {
  const registry = buildAgentRegistry()
  const systemPrompt = registry.getCorePrompt("reviewer.md")
  const userPrompt = assembleUserPrompt(config, phase, checkpointTag, cwd, sensorFindings)
  const { onStdout, flush } = createLegacyStdoutDisplay({ suppressJsonBlock: true, projectRoot: cwd ?? process.cwd() })
  const prepared = prepareAgentsAndPlugins(config)
  try {
    return await runClaudeProcess({
      systemPrompt,
      userPrompt,
      model: config.model,
      allowedTools: ["Read", "Bash", "Glob", "Grep", "Agent", "Skill"],
      ...commonInvokeOptions(config, prepared, onStdout, cwd),
    })
  } finally {
    flush()
    cleanupPluginDirs(prepared.pluginDirs)
  }
}

/** Engine-path reviewer (AI-SDK providers): same prompt + read-only tool surface
 *  + Zod-validated ReviewVerdict. */
const runReviewerViaEngine = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  checkpointTag: string,
  cwd: string | undefined,
  sensorFindings: SensorFinding[] | undefined,
  engine: Engine,
): Promise<ClaudeResult> => {
  const registry = buildAgentRegistry()
  const roleSystem = registry.getCorePrompt("reviewer.md")
  const userPrompt = assembleUserPrompt(config, phase, checkpointTag, cwd, sensorFindings)
  const tools = buildToolSurface("reviewer", toolContextFromConfig(config, cwd))
  const { onChunk, flush } = createStreamDisplay({ projectRoot: cwd ?? process.cwd() })
  const wallStart = Date.now()
  try {
    const result = await runClaudeOneShot({
      engine,
      model: config.model,
      system: roleSystem,
      prompt: userPrompt,
      tools,
      maxSteps: ENGINE_REVIEWER_MAX_STEPS,
      schema: reviewVerdictSchema,
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
 * Run the phase reviewer. Claude (the byte-stable spawn path) unless an `engine`
 * is supplied (non-Claude build), in which case the in-process engine path runs.
 * Verdict extraction (`parseVerdict` + sensor findings) is shared.
 */
export const runReviewer = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  checkpointTag: string,
  cwd?: string,
  sensorFindings?: SensorFinding[],
  engine?: Engine,
): Promise<{ result: ClaudeResult; verdict: ReviewVerdict }> => {
  const result = engine
    ? await runReviewerViaEngine(config, phase, checkpointTag, cwd, sensorFindings, engine)
    : await runReviewerViaSpawn(config, phase, checkpointTag, cwd, sensorFindings)
  const parsed = parseVerdict(result.result)
  const verdict: ReviewVerdict = { ...parsed, sensorFindings: sensorFindings ?? [] }
  return { result, verdict }
}
