import * as fs from "node:fs"
import * as path from "node:path"
import { ClaudeResult, SketchSpecialistDraft, EnsembleSpecResult } from "../../types"
import { invokeClaude } from "../claude/claude.exec"
import { createDisplayCallbacks } from "../claude/stream.decode"
import { parseFrontmatter } from "../discovery/agent.scan"
import { printInfo, printError } from "../../ui/output"
import { startSpinner, formatElapsed } from "../../ui/spinner"
import { resolveAgentPrompt } from "../claude/agent.prompt"
import { extractJSON } from "./ensemble.exec"
import { createStderrHandler } from "./pipeline.shared"

// ---------------------------------------------------------------------------
// Sketcher discovery — reads personality overlays from agents/sketchers/
// ---------------------------------------------------------------------------

type SketcherDef = {
  perspective: string
  overlay: string
}

const resolveSketchersDir = (): string | null => {
  const candidates = [
    path.join(__dirname, "..", "agents", "sketchers"),
    path.join(__dirname, "..", "..", "agents", "sketchers"),
    path.join(__dirname, "..", "..", "..", "src", "agents", "sketchers"),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir
  }
  return null
}

const discoverSketchers = (): SketcherDef[] => {
  const dir = resolveSketchersDir()
  if (!dir) return []

  const sketchers: SketcherDef[] = []

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue

    const filepath = path.join(dir, entry)
    try {
      const content = fs.readFileSync(filepath, "utf-8")
      const fm = parseFrontmatter(content)
      if (!fm) continue

      const perspectiveMatch = content.match(/^perspective:\s*(.+)$/m)
      const perspective = perspectiveMatch ? perspectiveMatch[1].trim() : fm.name

      const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim()
      if (!body) continue

      sketchers.push({ perspective, overlay: body })
    } catch {
      // Skip unreadable files
    }
  }

  return sketchers
}

// ---------------------------------------------------------------------------
// JSON schema for structured spec specialist output
// ---------------------------------------------------------------------------

const SPEC_SPECIALIST_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    perspective: { type: "string", description: "The specialist's perspective label" },
    spec: {
      type: "object",
      properties: {
        title: { type: "string" },
        overview: { type: "string" },
        features: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              acceptanceCriteria: { type: "array", items: { type: "string" } },
            },
            required: ["name", "description", "acceptanceCriteria"],
          },
        },
        scopeBoundaries: {
          type: "object",
          properties: {
            inScope: { type: "array", items: { type: "string" } },
            outOfScope: { type: "array", items: { type: "string" } },
          },
          required: ["inScope", "outOfScope"],
        },
      },
      required: ["title", "overview", "features", "scopeBoundaries"],
    },
    constraints: {
      type: "object",
      properties: {
        language: { type: "string" },
        runtime: { type: "string" },
        framework: { type: ["string", "null"] },
        directoryConventions: { type: "string" },
        namingConventions: { type: "string" },
        apiStyle: { type: ["string", "null"] },
        database: { type: ["string", "null"] },
        dependencies: { type: "array", items: { type: "string" } },
        checkCommand: { type: "string" },
      },
      required: ["language", "runtime", "directoryConventions", "namingConventions", "dependencies", "checkCommand"],
    },
    taste: {
      type: ["object", "null"],
      properties: {
        codeStyle: { type: "array", items: { type: "string" } },
        testPatterns: { type: "array", items: { type: "string" } },
        commitFormat: { type: ["string", "null"] },
        commentStyle: { type: ["string", "null"] },
      },
    },
    tradeoffs: { type: "string", description: "What this approach sacrifices" },
    concerns: {
      type: "array",
      items: { type: "string" },
      description: "Things the other specialists might miss",
    },
  },
  required: ["perspective", "spec", "constraints", "tradeoffs", "concerns"],
})

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/** Build a spec specialist system prompt from the overlay + base instructions. */
const buildSpecSpecialistPrompt = (overlay: string): string => {
  const jsonDirective = [
    "",
    "## Your Task",
    "",
    "Read the shape document below and produce a structured proposal for spec.md, constraints.md, and optionally taste.md.",
    "Return your proposal as a single JSON object.",
    "Do NOT use the Write tool. Do NOT produce markdown. Do NOT write prose or commentary.",
    "Your entire response must be valid JSON matching the provided schema.",
    "",
    "Your JSON must include:",
    "- `perspective`: Your specialist perspective label",
    "- `spec`: { title, overview, features (with name, description, acceptanceCriteria), scopeBoundaries (inScope, outOfScope) }",
    "- `constraints`: { language, runtime, framework, directoryConventions, namingConventions, apiStyle, database, dependencies, checkCommand }",
    "- `taste`: { codeStyle, testPatterns, commitFormat, commentStyle } or null if no style preferences expressed",
    "- `tradeoffs`: What your approach sacrifices",
    "- `concerns`: Things the other specialists might miss",
  ].join("\n")

  return `${overlay}${jsonDirective}`
}

/** Assemble the user prompt for a spec specialist — just the shape content. */
const assembleSpecialistUserPrompt = (shapeMd: string): string => {
  return `## shape.md\n\n${shapeMd}\n\nIMPORTANT: Respond with ONLY a JSON object. No prose, no markdown, no commentary. Just the JSON.`
}

/** Assemble the user prompt for the specifier synthesizer. */
const assembleSynthesizerUserPrompt = (
  shapeMd: string,
  buildDir: string,
  proposals: { perspective: string; draft: SketchSpecialistDraft }[],
): string => {
  const sections: string[] = []

  sections.push("## shape.md\n")
  sections.push(shapeMd)
  sections.push("")

  sections.push("## Specialist Proposals\n")
  for (const { perspective, draft } of proposals) {
    sections.push(`### ${perspective.charAt(0).toUpperCase() + perspective.slice(1)} Specialist\n`)
    sections.push(`**Tradeoffs:** ${draft.tradeoffs}\n`)
    sections.push(`**Concerns:** ${draft.concerns.join("; ")}\n`)

    sections.push("**Spec Proposal:**")
    sections.push(`- Title: ${draft.spec.title}`)
    sections.push(`- Overview: ${draft.spec.overview}`)
    sections.push(`- Features (${draft.spec.features.length}):`)
    for (const feature of draft.spec.features) {
      sections.push(`  - **${feature.name}**: ${feature.description}`)
      sections.push(`    Criteria: ${feature.acceptanceCriteria.join("; ")}`)
    }
    sections.push(`- In scope: ${draft.spec.scopeBoundaries.inScope.join("; ")}`)
    sections.push(`- Out of scope: ${draft.spec.scopeBoundaries.outOfScope.join("; ")}`)
    sections.push("")

    sections.push("**Constraints Proposal:**")
    sections.push(`- Language: ${draft.constraints.language}, Runtime: ${draft.constraints.runtime}`)
    if (draft.constraints.framework) sections.push(`- Framework: ${draft.constraints.framework}`)
    sections.push(`- Directory: ${draft.constraints.directoryConventions}`)
    sections.push(`- Naming: ${draft.constraints.namingConventions}`)
    if (draft.constraints.apiStyle) sections.push(`- API style: ${draft.constraints.apiStyle}`)
    if (draft.constraints.database) sections.push(`- Database: ${draft.constraints.database}`)
    sections.push(`- Dependencies: ${draft.constraints.dependencies.join(", ")}`)
    sections.push(`- Check command: \`${draft.constraints.checkCommand}\``)
    sections.push("")

    if (draft.taste) {
      sections.push("**Taste Proposal:**")
      if (draft.taste.codeStyle.length > 0) sections.push(`- Code style: ${draft.taste.codeStyle.join("; ")}`)
      if (draft.taste.testPatterns.length > 0) sections.push(`- Test patterns: ${draft.taste.testPatterns.join("; ")}`)
      if (draft.taste.commitFormat) sections.push(`- Commit format: ${draft.taste.commitFormat}`)
      if (draft.taste.commentStyle) sections.push(`- Comment style: ${draft.taste.commentStyle}`)
      sections.push("")
    }

    sections.push("---\n")
  }

  sections.push("## Output Directory\n")
  sections.push(`Write spec.md, constraints.md, and optionally taste.md to: ${buildDir}/`)
  sections.push("Use the Write tool to create each file.")

  return sections.join("\n")
}

// ---------------------------------------------------------------------------
// Spec ensemble orchestration
// ---------------------------------------------------------------------------

export type SpecEnsembleConfig = {
  model: string
  timeoutMinutes: number
  maxBudgetUsd: number | null
  buildDir: string
}

export const invokeSpecEnsemble = async (
  shapeMd: string,
  config: SpecEnsembleConfig,
): Promise<EnsembleSpecResult> => {
  const sketchers = discoverSketchers()
  if (sketchers.length === 0) {
    throw new Error("No spec specialist overlays found in agents/sketchers/")
  }

  const specialistUserPrompt = assembleSpecialistUserPrompt(shapeMd)

  // --- Phase 1: Spawn spec specialists in parallel ---
  const spinner = startSpinner("Specifying")

  const specialistPromises = sketchers.map(({ perspective, overlay }) => {
    const systemPrompt = buildSpecSpecialistPrompt(overlay)
    const startTime = Date.now()

    return invokeClaude({
      systemPrompt,
      userPrompt: specialistUserPrompt,
      model: config.model,
      allowedTools: [],
      cwd: process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      jsonSchema: SPEC_SPECIALIST_SCHEMA,
      onStderr: createStderrHandler(perspective),
    }).then((result) => {
      const elapsed = formatElapsed(Date.now() - startTime)
      spinner.printAbove(`  ${perspective.padEnd(14)} complete (${elapsed}, $${result.costUsd.toFixed(2)})`)
      return { perspective, result }
    })
  })

  const settled = await Promise.allSettled(specialistPromises)

  // --- Phase 2: Collect successful proposals ---
  const successful: { perspective: string; result: ClaudeResult; draft: SketchSpecialistDraft }[] = []

  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      const { perspective, result } = outcome.value
      try {
        const draft = extractJSON(result.result) as SketchSpecialistDraft
        successful.push({ perspective, result, draft })
      } catch {
        const preview = result.result.length > 300
          ? result.result.slice(0, 300) + "…"
          : result.result
        printError(`Failed to parse ${perspective} specialist output as JSON. Preview:\n${preview}`)
      }
    } else {
      printError(`Specialist failed: ${outcome.reason}`)
    }
  }

  const minRequired = Math.ceil(sketchers.length / 2)
  if (successful.length < minRequired) {
    spinner.stop()
    throw new Error(
      `Spec generation requires at least ${minRequired} of ${sketchers.length} specialist proposals to succeed, got ${successful.length}. ` +
      "Check Claude authentication and try again."
    )
  }

  if (successful.length < sketchers.length) {
    printInfo(`Continuing with ${successful.length} of ${sketchers.length} proposals`)
  }

  // --- Budget guard ---
  const specialistCost = successful.reduce((sum, s) => sum + s.result.costUsd, 0)
  if (config.maxBudgetUsd !== null && specialistCost >= config.maxBudgetUsd) {
    spinner.stop()
    throw new Error(
      `Specialist cost ($${specialistCost.toFixed(2)}) already exceeds budget ($${config.maxBudgetUsd.toFixed(2)}). ` +
      "Skipping synthesis to avoid further cost."
    )
  }

  // --- Phase 3: Synthesize with the specifier ---
  spinner.stop()
  printInfo("Synthesizing spec from specialist proposals...")

  const specifierPrompt = resolveAgentPrompt("specifier.md")
  const synthesizerUserPrompt = assembleSynthesizerUserPrompt(
    shapeMd,
    config.buildDir,
    successful.map(({ perspective, draft }) => ({ perspective, draft })),
  )
  const { onStdout, flush } = createDisplayCallbacks({ projectRoot: process.cwd() })

  let synthResult: ClaudeResult
  try {
    synthResult = await invokeClaude({
      systemPrompt: specifierPrompt,
      userPrompt: synthesizerUserPrompt,
      model: config.model,
      allowedTools: ["Write", "Read", "Glob", "Grep"],
      cwd: process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      onStdout,
      onStderr: createStderrHandler("specifier"),
    })
  } finally {
    flush()
  }

  // --- Phase 4: Return results ---
  const specialistResults = successful.map((s) => s.result)
  const totalCostUsd = specialistCost + synthResult.costUsd
  const totalDurationMs = Math.max(...specialistResults.map((r) => r.durationMs)) + synthResult.durationMs

  return {
    specialistResults,
    synthesizerResult: synthResult,
    totalCostUsd,
    totalDurationMs,
  }
}
