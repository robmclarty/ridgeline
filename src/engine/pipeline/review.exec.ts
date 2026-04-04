import * as fs from "node:fs"
import { RidgelineConfig, PhaseInfo, ClaudeResult, ReviewVerdict } from "../../types"
import { invokeClaude } from "../claude/claude.exec"
import { resolveAgentPrompt } from "../claude/agent.prompt"
import { createDisplayCallbacks } from "../claude/stream.decode"
import { getDiff } from "../../git"
import { discoverBuiltinAgents, buildAgentsFlag } from "../discovery/agent.scan"
import { discoverPluginDirs, cleanupPluginDirs, getCorePluginDir } from "../discovery/plugin.scan"
import { parseVerdict } from "../../store/feedback"

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
  const systemPrompt = resolveAgentPrompt("reviewer.md")
  const userPrompt = assembleUserPrompt(config, phase, checkpointTag)
  const { onStdout, flush } = createDisplayCallbacks()

  const builtinAgents = discoverBuiltinAgents()
  const agents = buildAgentsFlag(builtinAgents)
  const pluginDirs = discoverPluginDirs(config)

  // Include core hooks plugin when running in unsafe mode (no sandbox)
  if (config.unsafe && !config.sandboxProvider) {
    const coreDir = getCorePluginDir()
    if (coreDir) {
      pluginDirs.push({ dir: coreDir, createdPluginJson: false })
    }
  }

  try {
    const result = await invokeClaude({
      systemPrompt,
      userPrompt,
      model: config.model,
      allowedTools: ["Read", "Bash", "Glob", "Grep", "Agent"],
      agents: Object.keys(agents).length > 0 ? agents : undefined,
      pluginDirs: pluginDirs.length > 0 ? pluginDirs.map((p) => p.dir) : undefined,
      cwd: config.worktreePath ?? process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      onStdout,
      sandboxProvider: config.sandboxProvider,
      networkAllowlist: config.networkAllowlist,
    })

    const verdict = parseVerdict(result.result)
    return { result, verdict }
  } finally {
    flush()
    cleanupPluginDirs(pluginDirs)
  }
}
