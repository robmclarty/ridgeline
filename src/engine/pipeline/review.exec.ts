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
import { PromptDocument } from "./prompt.document"

const assembleUserPrompt = (
  config: RidgelineConfig,
  phase: PhaseInfo,
  checkpointTag: string,
  cwd?: string,
): string => {
  const doc = new PromptDocument()

  doc.data("Phase Spec", fs.readFileSync(phase.filepath, "utf-8"))

  const diff = getDiff(checkpointTag, cwd)
  if (diff) {
    doc.dataFenced("Git Diff (checkpoint to HEAD)", diff, "diff")
  } else {
    doc.data("Git Diff (checkpoint to HEAD)", "No changes detected.")
  }

  doc.data("constraints.md", fs.readFileSync(config.constraintsPath, "utf-8"))

  appendDesign(doc, config)

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

export const invokeReviewer = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  checkpointTag: string,
  cwd?: string,
): Promise<{ result: ClaudeResult; verdict: ReviewVerdict }> => {
  const registry = buildAgentRegistry(resolveFlavour(config.flavour))
  const systemPrompt = registry.getCorePrompt("reviewer.md")
  const userPrompt = assembleUserPrompt(config, phase, checkpointTag, cwd)
  const { onStdout, flush } = createDisplayCallbacks({ suppressJsonBlock: true, projectRoot: cwd ?? process.cwd() })
  const prepared = prepareAgentsAndPlugins(config)

  try {
    const result = await invokeClaude({
      systemPrompt,
      userPrompt,
      model: config.model,
      allowedTools: ["Read", "Bash", "Glob", "Grep", "Agent", "Skill"],
      ...commonInvokeOptions(config, prepared, onStdout, cwd),
    })

    const verdict = parseVerdict(result.result)
    return { result, verdict }
  } finally {
    flush()
    cleanupPluginDirs(prepared.pluginDirs)
  }
}
