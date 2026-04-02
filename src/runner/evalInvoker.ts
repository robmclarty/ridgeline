import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig, PhaseInfo, ClaudeResult, EvalVerdict } from "../types"
import { invokeClaude } from "./claudeInvoker"
import { getDiff, getChangedFileContents } from "../git"

const resolveAgentPrompt = (filename: string): string => {
  const distPath = path.join(__dirname, "agents", filename)
  if (fs.existsSync(distPath)) return fs.readFileSync(distPath, "utf-8")
  const srcPath = path.join(__dirname, "..", "agents", filename)
  if (fs.existsSync(srcPath)) return fs.readFileSync(srcPath, "utf-8")
  const rootPath = path.join(__dirname, "..", "..", "src", "agents", filename)
  return fs.readFileSync(rootPath, "utf-8")
}

// Extract the JSON verdict block from evaluator's text output
export const parseVerdict = (text: string): EvalVerdict => {
  // Look for a JSON block that contains "passed"
  const jsonMatch = text.match(/\{[\s\S]*?"passed"\s*:[\s\S]*?\n\}/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0])
    } catch {
      // Fall through to fenced block search
    }
  }

  // Try extracting from fenced code block
  const fencedMatch = text.match(/```(?:json)?\s*\n(\{[\s\S]*?\})\s*\n```/)
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1])
    } catch {
      // Fall through
    }
  }

  // Default: assume failure if we can't parse
  return {
    passed: false,
    summary: "Could not parse evaluator verdict from output",
    criteriaResults: [],
    issues: ["Evaluator output did not contain a valid JSON verdict"],
    suggestions: [],
  }
}

const assembleUserPrompt = (
  config: RidgelineConfig,
  phase: PhaseInfo,
  checkpointTag: string,
  checkOutput: { command: string; output: string; exitCode: number } | null
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

  const changedFiles = getChangedFileContents(checkpointTag)
  if (changedFiles.size > 0) {
    sections.push("## Full Contents of Changed Files\n")
    for (const [filename, content] of changedFiles) {
      sections.push(`### ${filename}\n`)
      sections.push("```")
      sections.push(content)
      sections.push("```")
      sections.push("")
    }
  }

  sections.push("## constraints.md\n")
  sections.push(fs.readFileSync(config.constraintsPath, "utf-8"))
  sections.push("")

  if (checkOutput) {
    sections.push("## Check Command Results\n")
    sections.push(`Command: \`${checkOutput.command}\``)
    sections.push(`Exit code: ${checkOutput.exitCode}\n`)
    sections.push("```")
    sections.push(checkOutput.output)
    sections.push("```")
    sections.push("")
  }

  const feedbackPath = phase.filepath.replace(/\.md$/, ".feedback.md")
  sections.push("## Feedback Path\n")
  sections.push(`If this phase fails, write your feedback to: ${feedbackPath}`)
  sections.push("")

  return sections.join("\n")
}

export const invokeEvaluator = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  checkpointTag: string,
  checkOutput: { command: string; output: string; exitCode: number } | null
): Promise<{ result: ClaudeResult; verdict: EvalVerdict }> => {
  const systemPrompt = resolveAgentPrompt("evaluator.md")
  const userPrompt = assembleUserPrompt(config, phase, checkpointTag, checkOutput)

  const result = await invokeClaude({
    systemPrompt,
    userPrompt,
    model: config.model,
    allowedTools: ["Read", "Write", "Bash", "Glob", "Grep"],
    cwd: process.cwd(),
    verbose: config.verbose,
    timeoutMs: config.timeoutMinutes * 60 * 1000,
  })

  const verdict = parseVerdict(result.result)
  return { result, verdict }
}
