import * as fs from "node:fs"
import { RidgelineConfig, PhaseInfo, ClaudeResult, ReviewVerdict } from "../../types"
import { invokeClaude } from "../claude/claude.exec"
import { createDisplayCallbacks } from "../claude/stream.display"
import { getDiff } from "../../git"
import { parseVerdict } from "../../stores/feedback.verdict"
import { cleanupPluginDirs } from "../discovery/plugin.scan"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { resolveFlavour } from "../discovery/flavour.resolve"
import { prepareAgentsAndPlugins, commonInvokeOptions, appendDesign } from "./pipeline.shared"
import { getMatchedShapes } from "../../stores/state"
import { loadShapeDefinitions } from "../../shapes/detect"

const assembleUserPrompt = (
  config: RidgelineConfig,
  phase: PhaseInfo,
  checkpointTag: string
): string => {
  const sections: string[] = []

  sections.push("## Phase Spec\n")
  sections.push(fs.readFileSync(phase.filepath, "utf-8"))
  sections.push("")

  const diff = getDiff(checkpointTag)
  sections.push("## Git Diff (checkpoint to HEAD)\n")
  if (diff) {
    sections.push("```diff")
    sections.push(diff)
    sections.push("```")
  } else {
    sections.push("No changes detected.")
  }
  sections.push("")

  sections.push("## constraints.md\n")
  sections.push(fs.readFileSync(config.constraintsPath, "utf-8"))
  sections.push("")

  // Inject design.md
  appendDesign(sections, config)

  // Inject reviewer context from matched shapes
  const matchedShapeNames = getMatchedShapes(config.buildDir)
  if (matchedShapeNames.length > 0) {
    const allDefs = loadShapeDefinitions()
    const matchedDefs = allDefs.filter((d) => matchedShapeNames.includes(d.name))

    if (matchedDefs.length > 0) {
      sections.push("## Visual Design Review Context\n")
      sections.push("The following visual design heuristics apply to this phase:\n")
      for (const def of matchedDefs) {
        sections.push(`### ${def.name}\n`)
        sections.push(def.reviewerContext)
        sections.push("")
      }
      sections.push("**Review rules for design.md:**")
      sections.push("- Hard token violations (specific values with imperative language) → severity: blocking")
      sections.push("- Soft guidance deviations (directional language) → severity: suggestion")
      sections.push("- Skipped tools → noted in verdict, never blocking")
      sections.push("")
    }
  }

  return sections.join("\n")
}

export const invokeReviewer = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  checkpointTag: string
): Promise<{ result: ClaudeResult; verdict: ReviewVerdict }> => {
  const registry = buildAgentRegistry(resolveFlavour(config.flavour))
  const systemPrompt = registry.getCorePrompt("reviewer.md")
  const userPrompt = assembleUserPrompt(config, phase, checkpointTag)
  const { onStdout, flush } = createDisplayCallbacks({ suppressJsonBlock: true, projectRoot: process.cwd() })
  const prepared = prepareAgentsAndPlugins(config)

  try {
    const result = await invokeClaude({
      systemPrompt,
      userPrompt,
      model: config.model,
      allowedTools: ["Read", "Bash", "Glob", "Grep", "Agent"],
      ...commonInvokeOptions(config, prepared, onStdout),
    })

    const verdict = parseVerdict(result.result)
    return { result, verdict }
  } finally {
    flush()
    cleanupPluginDirs(prepared.pluginDirs)
  }
}
