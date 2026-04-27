import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig, PlanVerdict, ClaudeResult } from "../../types"
import { invokeClaude } from "../claude/claude.exec"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { PromptDocument } from "./prompt.document"
import { appendBaseUserPrompt } from "./plan.exec"
import { scanPhases } from "../../stores/phases"
import { logTrajectory } from "../../stores/trajectory"
import { printInfo, printWarn } from "../../ui/output"
import { createDisplayCallbacks } from "../claude/stream.display"
import { createStderrHandler } from "./pipeline.shared"

/** Approximate output tokens a phase will require, based on its acceptance-criteria count and spec length. */
const estimatePhaseOutputTokens = (phaseContent: string): number => {
  const acceptanceMatch = phaseContent.match(/##\s+Acceptance Criteria([\s\S]*?)(?=^##\s+|$(?![\r\n]))/m)
  const acceptanceBlock = acceptanceMatch ? acceptanceMatch[1] : ""
  const criteriaCount = (acceptanceBlock.match(/^\s*[-*\d]+[.)]?\s+/gm) ?? []).length
  const wordCount = phaseContent.split(/\s+/).filter(Boolean).length
  return Math.ceil(criteriaCount * 1500 + wordCount * 4)
}

type PhaseEstimate = {
  id: string
  estimatedOutputTokens: number
  exceedsBudget: boolean
}

/** Deterministic per-phase output-token estimate; flags any phase over the configured ceiling. */
const estimatePhases = (config: RidgelineConfig): PhaseEstimate[] => {
  const phases = scanPhases(config.phasesDir)
  return phases.map((phase) => {
    const content = fs.readFileSync(phase.filepath, "utf-8")
    const estimatedOutputTokens = estimatePhaseOutputTokens(content)
    return {
      id: phase.id,
      estimatedOutputTokens,
      exceedsBudget: estimatedOutputTokens > config.phaseTokenLimit,
    }
  })
}

/** Print a soft warning for any phase whose estimated output exceeds the budget. */
export const reportPhaseSizeWarnings = (config: RidgelineConfig): PhaseEstimate[] => {
  const estimates = estimatePhases(config)
  for (const e of estimates) {
    if (!e.exceedsBudget) continue
    printWarn(
      `Phase ${e.id} estimated at ~${e.estimatedOutputTokens.toLocaleString()} output tokens ` +
        `(budget: ${config.phaseTokenLimit.toLocaleString()}). Consider splitting.`,
    )
  }
  return estimates
}

const buildReviewerUserPrompt = (config: RidgelineConfig, phasesMd: string): string => {
  const doc = new PromptDocument()
  appendBaseUserPrompt(doc, config)
  doc.data("Synthesized Plan (phase files)", phasesMd)
  doc.instruction(
    "Output Format",
    "Respond with ONLY a JSON object matching the schema in your system prompt. No prose, no markdown fences, no commentary.",
  )
  return doc.render()
}

const renderPhasesAsMarkdown = (config: RidgelineConfig): string => {
  const phases = scanPhases(config.phasesDir)
  return phases
    .map((p) => {
      const content = fs.readFileSync(p.filepath, "utf-8")
      return `### ${p.filename}\n\n${content}`
    })
    .join("\n\n---\n\n")
}

const parseVerdict = (raw: string): PlanVerdict => {
  const trimmed = raw.trim()
  // Strip code fences if the model added them despite instructions
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1].trim() : trimmed
  const parsed = JSON.parse(candidate) as { approved?: unknown; issues?: unknown }
  const approved = parsed.approved === true
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.filter((i): i is string => typeof i === "string")
    : []
  return { approved, issues }
}

/** Run the adversarial plan reviewer against the synthesized plan files on disk. */
export const runPlanReviewer = async (
  config: RidgelineConfig,
): Promise<{ verdict: PlanVerdict; result: ClaudeResult }> => {
  const registry = buildAgentRegistry()
  const systemPrompt = registry.getCorePrompt("plan-reviewer.md")
  const phasesMd = renderPhasesAsMarkdown(config)
  const userPrompt = buildReviewerUserPrompt(config, phasesMd)

  printInfo("Running adversarial plan reviewer...")
  const { onStdout, flush } = createDisplayCallbacks({ projectRoot: process.cwd(), dimText: true })
  let result: ClaudeResult
  try {
    result = await invokeClaude({
      systemPrompt,
      userPrompt,
      model: config.model,
      cwd: process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      onStdout,
      onStderr: createStderrHandler("plan-reviewer"),
    })
  } finally {
    flush()
  }

  let verdict: PlanVerdict
  try {
    verdict = parseVerdict(result.result)
  } catch (err) {
    printWarn(`Plan reviewer returned malformed output; treating as approved. (${err instanceof Error ? err.message : String(err)})`)
    verdict = { approved: true, issues: [] }
  }

  logTrajectory(config.buildDir, "plan_complete", null,
    `Plan reviewer verdict: ${verdict.approved ? "approved" : `rejected (${verdict.issues.length} issue(s))`}`,
    { reason: verdict.approved ? "approved" : "rejected" })

  return { verdict, result }
}

/**
 * Re-invoke the synthesizer with reviewer feedback to produce a revised plan.
 *
 * The synthesizer reads the same spec/constraints/taste plus an explicit list of issues
 * to address, and rewrites the phase files in place. This is one-shot: the revised plan
 * is accepted as-is, no further review.
 */
export const revisePlanWithFeedback = async (
  config: RidgelineConfig,
  issues: string[],
): Promise<ClaudeResult> => {
  const registry = buildAgentRegistry()
  const synthesizerPrompt = registry.getCorePrompt("planner.md")

  // Wipe existing phase files so the synthesizer doesn't append.
  const existing = fs.readdirSync(config.phasesDir).filter((f) => f.endsWith(".md"))
  for (const f of existing) {
    fs.unlinkSync(path.join(config.phasesDir, f))
  }

  const doc = new PromptDocument()
  appendBaseUserPrompt(doc, config)
  doc.data(
    "Reviewer Feedback (must be addressed)",
    issues.map((iss, i) => `${i + 1}. ${iss}`).join("\n"),
  )
  doc.instruction(
    "Output Directory",
    `Rewrite phase spec files to: ${config.phasesDir}\nUse the naming convention: 01-<slug>.md, 02-<slug>.md, etc. ` +
      `Address every reviewer issue listed above. Do not preserve the previous plan's structure unless it was correct.`,
  )

  printInfo(`Revising plan to address ${issues.length} reviewer issue(s)...`)
  const { onStdout, flush } = createDisplayCallbacks({ projectRoot: process.cwd(), dimText: true })
  try {
    return await invokeClaude({
      systemPrompt: synthesizerPrompt,
      userPrompt: doc.render(),
      model: config.model,
      allowedTools: ["Write", "Skill"],
      cwd: process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      onStdout,
      onStderr: createStderrHandler("plan-reviser"),
    })
  } finally {
    flush()
  }
}
