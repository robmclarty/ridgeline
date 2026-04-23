import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig, PhaseInfo, ClaudeResult } from "../../types"
import { invokeClaude } from "../claude/claude.exec"
import { createDisplayCallbacks } from "../claude/stream.display"
import { readHandoff } from "../../stores/handoff"
import { cleanupPluginDirs } from "../discovery/plugin.scan"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { prepareAgentsAndPlugins, appendConstraintsAndTaste, appendDesign, appendAssetCatalog, commonInvokeOptions } from "./pipeline.shared"
import { PromptDocument } from "./prompt.document"

const assembleUserPrompt = (
  config: RidgelineConfig,
  phase: PhaseInfo,
  feedbackPath: string | null
): string => {
  const doc = new PromptDocument()

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

  // Handoff file path for the builder to append to
  doc.instruction("Handoff File", `Append your handoff notes to: ${path.join(config.buildDir, "handoff.md")}`)

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
  const userPrompt = assembleUserPrompt(config, phase, feedbackPath)
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
