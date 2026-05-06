import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig, PhaseInfo, ClaudeResult } from "../../types"
import { invokeClaude } from "../claude/claude.exec"
import { createDisplayCallbacks } from "../claude/stream.display"
import { readHandoff } from "../../stores/handoff"
import { cleanupPluginDirs } from "../discovery/plugin.scan"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { prepareAgentsAndPlugins, appendConstraintsAndTaste, appendDesign, appendAssetCatalog, commonInvokeOptions } from "./pipeline.shared"
import { createPromptDocument } from "./prompt.document"

/**
 * Resolve the file path the builder should append handoff notes to.
 * In the sequential path (cwd unset), this is the canonical handoff.md.
 * In the wave path (cwd is a worktree), this is a per-phase fragment
 * inside the worktree's buildDir, so concurrent phases never collide
 * on the same file at git-merge time. Fragments are stitched back into
 * the canonical handoff.md by consolidateHandoffs after the wave merges.
 */
const resolveHandoffTarget = (config: RidgelineConfig, phase: PhaseInfo, cwd?: string): string => {
  if (!cwd) return path.join(config.buildDir, "handoff.md")
  return path.join(cwd, ".ridgeline", "builds", config.buildName, `handoff-${phase.id}.md`)
}

const assembleUserPrompt = (
  config: RidgelineConfig,
  phase: PhaseInfo,
  feedbackPath: string | null,
  cwd?: string,
): string => {
  const doc = createPromptDocument()

  appendConstraintsAndTaste(doc, config)
  appendDesign(doc, config)
  appendAssetCatalog(doc, config)

  // Inject learnings from previous builds if available
  const learningsPath = path.join(config.ridgelineDir, "learnings.md")
  if (fs.existsSync(learningsPath)) {
    const learnings = fs.readFileSync(learningsPath, "utf-8").trim()
    if (learnings) {
      doc.data("Learnings from Previous Builds", learnings)
    }
  }

  const handoff = readHandoff(config.buildDir)
  if (handoff) {
    doc.data("handoff.md", handoff)
  }

  doc.data("Phase Spec", fs.readFileSync(phase.filepath, "utf-8"))

  if (config.checkCommand) {
    doc.instruction(
      "Check Command",
      `Run this command after making changes to verify correctness:\n\n\`\`\`\n${config.checkCommand}\n\`\`\``,
    )
  }

  // Handoff file path for the builder to append to. Wave runs use a
  // per-phase fragment so parallel phases don't collide at merge time.
  doc.instruction("Handoff File", `Append your handoff notes to: ${resolveHandoffTarget(config, phase, cwd)}`)

  if (feedbackPath && fs.existsSync(feedbackPath)) {
    doc.data(
      "Reviewer Feedback (RETRY)",
      "This is a retry. The reviewer found issues with your previous attempt.\n" +
      "Focus on fixing these issues. Do not redo work that already passed.\n\n" +
      fs.readFileSync(feedbackPath, "utf-8"),
    )
  }

  return doc.render()
}

export const invokeBuilder = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  feedbackPath: string | null,
  cwd?: string,
): Promise<ClaudeResult> => {
  const registry = buildAgentRegistry()
  const systemPrompt = registry.getCorePrompt("builder.md")
  const userPrompt = assembleUserPrompt(config, phase, feedbackPath, cwd)
  const { onStdout, flush } = createDisplayCallbacks({ projectRoot: cwd ?? process.cwd() })
  const prepared = prepareAgentsAndPlugins(config)

  try {
    const result = await invokeClaude({
      systemPrompt,
      userPrompt,
      model: config.model,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent", "Skill"],
      ...commonInvokeOptions(config, prepared, onStdout, cwd),
    })

    return result
  } finally {
    flush()
    cleanupPluginDirs(prepared.pluginDirs)
  }
}
