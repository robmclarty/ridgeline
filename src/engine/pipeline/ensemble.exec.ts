import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig, PhaseInfo, ClaudeResult, SpecialistProposal, EnsemblePlanResult } from "../../types"
import { invokeClaude } from "../claude/claude.exec"
import { createDisplayCallbacks } from "../claude/stream.decode"
import { scanPhases } from "../../store/phases"
import { parseFrontmatter } from "../discovery/agent.scan"
import { printInfo, printError } from "../../ui/output"
import { startSpinner, formatElapsed } from "../../ui/spinner"
import { resolveAgentPrompt } from "../claude/agent.prompt"
import { assembleBaseUserPrompt } from "./plan.exec"

// ---------------------------------------------------------------------------
// Planner discovery — reads personality overlays from agents/planners/
// ---------------------------------------------------------------------------

type PlannerDef = {
  perspective: string
  overlay: string
}

const resolvePlannersDir = (): string | null => {
  const candidates = [
    path.join(__dirname, "..", "agents", "planners"),
    path.join(__dirname, "..", "..", "agents", "planners"),
    path.join(__dirname, "..", "..", "..", "src", "agents", "planners"),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir
  }
  return null
}

const discoverPlanners = (): PlannerDef[] => {
  const dir = resolvePlannersDir()
  if (!dir) return []

  const planners: PlannerDef[] = []

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue
    if (entry === "synthesizer.md") continue // synthesizer is not a specialist

    const filepath = path.join(dir, entry)
    try {
      const content = fs.readFileSync(filepath, "utf-8")
      const fm = parseFrontmatter(content)
      if (!fm) continue

      // Extract perspective from frontmatter or fall back to filename
      const perspectiveMatch = content.match(/^perspective:\s*(.+)$/m)
      const perspective = perspectiveMatch ? perspectiveMatch[1].trim() : fm.name

      // The overlay is the body after frontmatter
      const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim()
      if (!body) continue

      planners.push({ perspective, overlay: body })
    } catch {
      // Skip unreadable files
    }
  }

  return planners
}

const resolveSynthesizerPrompt = (): string => {
  const dir = resolvePlannersDir()
  if (dir) {
    const synthPath = path.join(dir, "synthesizer.md")
    if (fs.existsSync(synthPath)) return fs.readFileSync(synthPath, "utf-8")
  }
  // Fallback to core agents location
  return resolveAgentPrompt("synthesizer.md")
}

// ---------------------------------------------------------------------------
// JSON schema for structured specialist output
// ---------------------------------------------------------------------------

const SPECIALIST_PROPOSAL_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    perspective: { type: "string", description: "The specialist's perspective label" },
    summary: { type: "string", description: "1-2 sentence overview of the approach" },
    phases: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          slug: { type: "string", description: "Kebab-case slug for file naming" },
          goal: { type: "string", description: "1-3 paragraphs in business/product terms" },
          acceptanceCriteria: {
            type: "array",
            items: { type: "string" },
            description: "Concrete, verifiable outcomes",
          },
          specReference: { type: "string", description: "Relevant spec sections" },
          rationale: { type: "string", description: "Why this phase boundary exists" },
        },
        required: ["title", "slug", "goal", "acceptanceCriteria", "specReference", "rationale"],
      },
    },
    tradeoffs: { type: "string", description: "What this approach sacrifices" },
  },
  required: ["perspective", "summary", "phases", "tradeoffs"],
})

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Build a specialist system prompt by prepending the personality overlay to the
 * base planner prompt, then replacing the file-writing instructions with a
 * directive to return structured JSON.
 */
const buildSpecialistSystemPrompt = (basePrompt: string, overlay: string): string => {
  // Strip YAML frontmatter from the base prompt
  const withoutFrontmatter = basePrompt.replace(/^---\n[\s\S]*?\n---\n*/, "")

  // Remove the output-related sections that reference the Write tool and file naming
  const withoutOutput = withoutFrontmatter
    .replace(/## File Naming[\s\S]*?(?=## Phase Spec Format)/, "")
    .replace(/## Process[\s\S]*$/, "")

  const jsonDirective = [
    "",
    "## Output Format",
    "",
    "Return your plan as a single JSON object matching the provided schema.",
    "Do not use the Write tool. Do not produce markdown files.",
    "Include your perspective label, a brief summary, your proposed phases, and the tradeoffs of your approach.",
  ].join("\n")

  return `${overlay}\n\n${withoutOutput}${jsonDirective}`
}

/** Assemble the user prompt for a specialist (no output directory). */
const assembleSpecialistUserPrompt = (config: RidgelineConfig): string => {
  return assembleBaseUserPrompt(config) + "\n\nReturn your proposed plan as structured JSON."
}

/** Assemble the user prompt for the synthesizer, including all proposals. */
const assembleSynthesizerUserPrompt = (
  config: RidgelineConfig,
  proposals: { perspective: string; proposal: SpecialistProposal }[],
): string => {
  const sections: string[] = []

  // Include original inputs
  sections.push(assembleBaseUserPrompt(config))
  sections.push("")

  // Include each specialist proposal
  sections.push("## Specialist Proposals\n")
  for (const { perspective, proposal } of proposals) {
    sections.push(`### ${perspective.charAt(0).toUpperCase() + perspective.slice(1)} Specialist\n`)
    sections.push(`**Summary:** ${proposal.summary}\n`)
    sections.push(`**Tradeoffs:** ${proposal.tradeoffs}\n`)
    sections.push(`**Phases (${proposal.phases.length}):**\n`)
    for (let i = 0; i < proposal.phases.length; i++) {
      const phase = proposal.phases[i]
      sections.push(`#### Phase ${i + 1}: ${phase.title} (\`${phase.slug}\`)`)
      sections.push(`**Goal:** ${phase.goal}\n`)
      sections.push("**Acceptance Criteria:**")
      for (const criterion of phase.acceptanceCriteria) {
        sections.push(`- ${criterion}`)
      }
      sections.push(`\n**Spec Reference:** ${phase.specReference}`)
      sections.push(`**Rationale:** ${phase.rationale}\n`)
    }
    sections.push("---\n")
  }

  // Output directory
  sections.push("## Output Directory\n")
  sections.push(`Write phase spec files to: ${config.phasesDir}`)
  sections.push("Use the naming convention: 01-<slug>.md, 02-<slug>.md, etc.")

  return sections.join("\n")
}

// ---------------------------------------------------------------------------
// Ensemble orchestration
// ---------------------------------------------------------------------------

export const invokePlanner = async (
  config: RidgelineConfig
): Promise<{ result: ClaudeResult; phases: PhaseInfo[]; ensemble: EnsemblePlanResult }> => {
  const planners = discoverPlanners()
  if (planners.length === 0) {
    throw new Error("No planner personalities found in agents/planners/")
  }

  const basePrompt = resolveAgentPrompt("planner.md")
  const specialistUserPrompt = assembleSpecialistUserPrompt(config)

  // --- Phase 1: Spawn specialists in parallel ---
  const spinner = startSpinner("Planning")

  const specialistPromises = planners.map(({ perspective, overlay }) => {
    const systemPrompt = buildSpecialistSystemPrompt(basePrompt, overlay)
    const startTime = Date.now()

    return invokeClaude({
      systemPrompt,
      userPrompt: specialistUserPrompt,
      model: config.model,
      allowedTools: [],
      cwd: process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      jsonSchema: SPECIALIST_PROPOSAL_SCHEMA,
      onStderr: (text) => {
        const lower = text.toLowerCase()
        if (lower.includes("error") || lower.includes("auth") || lower.includes("unauthorized") || lower.includes("forbidden")) {
          printError(`[${perspective}] claude stderr: ${text.trim()}`)
        }
      },
    }).then((result) => {
      const elapsed = formatElapsed(Date.now() - startTime)
      spinner.printAbove(`  ${perspective.padEnd(14)} complete (${elapsed}, $${result.costUsd.toFixed(2)})`)
      return { perspective, result }
    })
  })

  const settled = await Promise.allSettled(specialistPromises)

  // --- Phase 2: Collect successful proposals ---
  const successful: { perspective: string; result: ClaudeResult; proposal: SpecialistProposal }[] = []

  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      const { perspective, result } = outcome.value
      try {
        const proposal = JSON.parse(result.result) as SpecialistProposal
        successful.push({ perspective, result, proposal })
      } catch {
        printError(`Failed to parse ${perspective} specialist output as JSON`)
      }
    } else {
      printError(`Specialist failed: ${outcome.reason}`)
    }
  }

  const minRequired = Math.ceil(planners.length / 2)
  if (successful.length < minRequired) {
    spinner.stop()
    throw new Error(
      `Planning requires at least ${minRequired} of ${planners.length} specialist proposals to succeed, got ${successful.length}. ` +
      "Check Claude authentication and try again."
    )
  }

  if (successful.length < planners.length) {
    printInfo(`Continuing with ${successful.length} of ${planners.length} proposals`)
  }

  // --- Budget guard ---
  const specialistCost = successful.reduce((sum, s) => sum + s.result.costUsd, 0)
  if (config.maxBudgetUsd !== null && specialistCost >= config.maxBudgetUsd) {
    spinner.stop()
    throw new Error(
      `Specialist planning cost ($${specialistCost.toFixed(2)}) already exceeds budget ($${config.maxBudgetUsd.toFixed(2)}). ` +
      "Skipping synthesis to avoid further cost."
    )
  }

  // --- Phase 3: Synthesize ---
  spinner.stop()
  printInfo("Synthesizing best plan from specialist proposals...")

  const synthesizerPrompt = resolveSynthesizerPrompt()
  const synthesizerUserPrompt = assembleSynthesizerUserPrompt(
    config,
    successful.map(({ perspective, proposal }) => ({ perspective, proposal })),
  )
  const { onStdout, flush } = createDisplayCallbacks({ projectRoot: process.cwd() })

  let synthResult: ClaudeResult
  try {
    synthResult = await invokeClaude({
      systemPrompt: synthesizerPrompt,
      userPrompt: synthesizerUserPrompt,
      model: config.model,
      allowedTools: ["Write"],
      cwd: process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      onStdout,
      onStderr: (text) => {
        const lower = text.toLowerCase()
        if (lower.includes("error") || lower.includes("auth") || lower.includes("unauthorized") || lower.includes("forbidden")) {
          printError(`[synthesizer] claude stderr: ${text.trim()}`)
        }
      },
    })
  } finally {
    flush()
  }

  // --- Phase 4: Collect results ---
  const phases = scanPhases(config.phasesDir)

  if (phases.length === 0) {
    throw new Error("Synthesizer did not generate any phase files")
  }

  const specialistResults = successful.map((s) => s.result)
  const totalCostUsd = specialistCost + synthResult.costUsd
  const totalDurationMs = Math.max(...specialistResults.map((r) => r.durationMs)) + synthResult.durationMs

  return {
    result: synthResult,
    phases,
    ensemble: {
      specialistResults,
      synthesizerResult: synthResult,
      totalCostUsd,
      totalDurationMs,
    },
  }
}
