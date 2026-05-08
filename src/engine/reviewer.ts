import * as fs from "node:fs"
import { RidgelineConfig, PhaseInfo, ClaudeResult, ReviewVerdict } from "../types.js"
import type { SensorFinding } from "../sensors/index.js"
import { runClaudeProcess } from "./claude-process.js"
import { createLegacyStdoutDisplay } from "../ui/claude-stream-display.js"
import { getDiff } from "../git.js"
import { parseVerdict } from "../stores/feedback.verdict.js"
import { cleanupPluginDirs } from "./discovery/plugin.scan.js"
import { buildAgentRegistry } from "./discovery/agent.registry.js"
import { prepareAgentsAndPlugins, commonInvokeOptions, appendDesign } from "./legacy-shared.js"
import { getMatchedShapes } from "../stores/state.js"
import { loadShapeDefinitions } from "../shapes/detect.js"
import { createPromptDocument } from "./prompt-document.js"

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

export const runReviewer = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  checkpointTag: string,
  cwd?: string,
  sensorFindings?: SensorFinding[],
): Promise<{ result: ClaudeResult; verdict: ReviewVerdict }> => {
  const registry = buildAgentRegistry()
  const systemPrompt = registry.getCorePrompt("reviewer.md")
  const userPrompt = assembleUserPrompt(config, phase, checkpointTag, cwd, sensorFindings)
  const { onStdout, flush } = createLegacyStdoutDisplay({ suppressJsonBlock: true, projectRoot: cwd ?? process.cwd() })
  const prepared = prepareAgentsAndPlugins(config)

  try {
    const result = await runClaudeProcess({
      systemPrompt,
      userPrompt,
      model: config.model,
      allowedTools: ["Read", "Bash", "Glob", "Grep", "Agent", "Skill"],
      ...commonInvokeOptions(config, prepared, onStdout, cwd),
    })

    const parsed = parseVerdict(result.result)
    const verdict: ReviewVerdict = { ...parsed, sensorFindings: sensorFindings ?? [] }
    return { result, verdict }
  } finally {
    flush()
    cleanupPluginDirs(prepared.pluginDirs)
  }
}
