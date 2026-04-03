import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig, PhaseInfo, ClaudeResult } from "../types"
import { invokeClaude } from "./claudeInvoker"
import { resolveAgentPrompt } from "./agentPrompt"
import { readHandoff } from "../state/handoff"

const assembleUserPrompt = (
  config: RidgelineConfig,
  phase: PhaseInfo,
  feedbackPath: string | null
): string => {
  const sections: string[] = []

  sections.push("## constraints.md\n")
  sections.push(fs.readFileSync(config.constraintsPath, "utf-8"))
  sections.push("")

  if (config.tastePath) {
    sections.push("## taste.md\n")
    sections.push(fs.readFileSync(config.tastePath, "utf-8"))
    sections.push("")
  }

  if (fs.existsSync(config.snapshotPath)) {
    sections.push("## snapshot.md\n")
    sections.push(fs.readFileSync(config.snapshotPath, "utf-8"))
    sections.push("")
  }

  const handoff = readHandoff(config.buildDir)
  if (handoff) {
    sections.push("## handoff.md\n")
    sections.push(handoff)
    sections.push("")
  }

  sections.push("## Phase Spec\n")
  sections.push(fs.readFileSync(phase.filepath, "utf-8"))
  sections.push("")

  if (config.checkCommand) {
    sections.push("## Check Command\n")
    sections.push("Run this command after making changes to verify correctness:\n")
    sections.push("```")
    sections.push(config.checkCommand)
    sections.push("```")
    sections.push("")
  }

  // Handoff file path for the builder to append to
  sections.push("## Handoff File\n")
  sections.push(`Append your handoff notes to: ${path.join(config.buildDir, "handoff.md")}`)
  sections.push("")

  if (feedbackPath && fs.existsSync(feedbackPath)) {
    sections.push("## Reviewer Feedback (RETRY)\n")
    sections.push("This is a retry. The reviewer found issues with your previous attempt.")
    sections.push("Focus on fixing these issues. Do not redo work that already passed.\n")
    sections.push(fs.readFileSync(feedbackPath, "utf-8"))
    sections.push("")
  }

  return sections.join("\n")
}

export const invokeBuilder = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  feedbackPath: string | null
): Promise<ClaudeResult> => {
  const systemPrompt = resolveAgentPrompt("builder.md")
  const userPrompt = assembleUserPrompt(config, phase, feedbackPath)

  return invokeClaude({
    systemPrompt,
    userPrompt,
    model: config.model,
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent"],
    cwd: process.cwd(),
    verbose: config.verbose,
    timeoutMs: config.timeoutMinutes * 60 * 1000,
  })
}
