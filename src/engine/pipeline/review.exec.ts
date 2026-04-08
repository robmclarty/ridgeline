import * as fs from "node:fs"
import { RidgelineConfig, PhaseInfo, ClaudeResult, ReviewVerdict } from "../../types"
import { invokeClaude } from "../claude/claude.exec"
import { createDisplayCallbacks } from "../claude/stream.decode"
import { getDiff } from "../../git"
import { parseVerdict } from "../../stores/feedback"
import { cleanupPluginDirs } from "../discovery/plugin.scan"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { resolveFlavour } from "../discovery/flavour.resolve"
import { prepareAgentsAndPlugins, commonInvokeOptions } from "./pipeline.shared"

const assembleUserPrompt = (
  config: RidgelineConfig,
  phase: PhaseInfo,
  checkpointTag: string
): string => {
  const sections: string[] = []

  sections.push("## Phase Spec\n")
  sections.push(fs.readFileSync(phase.filepath, "utf-8"))
  sections.push("")

  const diff = getDiff(checkpointTag, config.worktreePath ?? undefined)
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
  const { onStdout, flush } = createDisplayCallbacks({ suppressJsonBlock: true, projectRoot: config.worktreePath ?? process.cwd() })
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
