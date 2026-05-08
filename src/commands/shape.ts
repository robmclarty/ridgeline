import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import { printInfo, printError } from "../ui/output.js"
import { buildAgentRegistry } from "../engine/discovery/agent.registry.js"
import { advancePipeline, recordMatchedShapes } from "../stores/state.js"
import { resolveBuildDir } from "../config.js"
import { loadShapeDefinitions, detectShapes } from "../shapes/detect.js"
import { runDesign, runDesignAuto } from "./design.js"
import { askQuestion, runQAIntake, runOutputTurn, runOneShotCall } from "./qa-workflow.js"
import { resolveInput } from "./input.js"

const SHAPE_OUTPUT_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    projectName: { type: "string" },
    intent: { type: "string" },
    scope: {
      type: "object",
      properties: {
        size: { type: "string", enum: ["micro", "small", "medium", "large", "full-system"] },
        inScope: { type: "array", items: { type: "string" } },
        outOfScope: { type: "array", items: { type: "string" } },
      },
      required: ["size", "inScope", "outOfScope"],
    },
    solutionShape: { type: "string" },
    risksAndComplexities: { type: "array", items: { type: "string" } },
    existingLandscape: {
      type: "object",
      properties: {
        codebaseState: { type: "string" },
        externalDependencies: { type: "array", items: { type: "string" } },
        dataStructures: { type: "array", items: { type: "string" } },
        relevantModules: { type: "array", items: { type: "string" } },
      },
      required: ["codebaseState", "externalDependencies", "dataStructures", "relevantModules"],
    },
    technicalPreferences: {
      type: "object",
      properties: {
        errorHandling: { type: "string" },
        performance: { type: "string" },
        security: { type: "string" },
        tradeoffs: { type: "string" },
        style: { type: "string" },
      },
      required: ["errorHandling", "performance", "security", "tradeoffs", "style"],
    },
    runtime: {
      type: "object",
      properties: {
        devServerPort: { type: "integer", minimum: 1, maximum: 65535 },
      },
    },
  },
  required: ["projectName", "intent", "scope", "solutionShape", "risksAndComplexities", "existingLandscape", "technicalPreferences"],
})

type ShapeOutput = {
  projectName: string
  intent: string
  scope: { size: string; inScope: string[]; outOfScope: string[] }
  solutionShape: string
  risksAndComplexities: string[]
  existingLandscape: {
    codebaseState: string
    externalDependencies: string[]
    dataStructures: string[]
    relevantModules: string[]
  }
  technicalPreferences: {
    errorHandling: string
    performance: string
    security: string
    tradeoffs: string
    style: string
  }
  runtime?: {
    devServerPort?: number
  }
}

export type ShapeOptions = {
  model: string
  timeout: number
  input?: string
}

const resolveInputContext = async (
  rl: readline.Interface,
  input?: string
): Promise<string | null> => {
  if (input) {
    const resolved = resolveInput(input)
    if (resolved.type === "file") {
      printInfo(`Using input from: ${resolved.path}`)
    }
    return resolved.content
  }
  console.log("")
  const answer = await askQuestion(rl, "Describe what you want to build:\n> ")
  return answer || null
}

/** Format the structured shape output as shape.md markdown. */
export const formatShapeMd = (shape: ShapeOutput): string => {
  const lines: string[] = []

  lines.push(`# ${shape.projectName}`)
  lines.push("")
  lines.push("## Intent")
  lines.push("")
  lines.push(shape.intent)
  lines.push("")
  lines.push("## Scope")
  lines.push("")
  lines.push(`Size: ${shape.scope.size}`)
  lines.push("")
  lines.push("Boundaries:")
  lines.push("")
  lines.push("**In scope:**")
  for (const item of shape.scope.inScope) {
    lines.push(`- ${item}`)
  }
  lines.push("")
  lines.push("**Out of scope:**")
  for (const item of shape.scope.outOfScope) {
    lines.push(`- ${item}`)
  }
  lines.push("")
  lines.push("## Solution Shape")
  lines.push("")
  lines.push(shape.solutionShape)
  lines.push("")
  lines.push("## Risks & Complexities")
  lines.push("")
  for (const risk of shape.risksAndComplexities) {
    lines.push(`- ${risk}`)
  }
  lines.push("")
  lines.push("## Existing Landscape")
  lines.push("")
  if (shape.existingLandscape.codebaseState) {
    lines.push(shape.existingLandscape.codebaseState)
    lines.push("")
  }
  if (shape.existingLandscape.externalDependencies.length > 0) {
    lines.push("**External dependencies:**")
    for (const dep of shape.existingLandscape.externalDependencies) {
      lines.push(`- ${dep}`)
    }
    lines.push("")
  }
  if (shape.existingLandscape.dataStructures.length > 0) {
    lines.push("**Data structures:**")
    for (const ds of shape.existingLandscape.dataStructures) {
      lines.push(`- ${ds}`)
    }
    lines.push("")
  }
  if (shape.existingLandscape.relevantModules.length > 0) {
    lines.push("**Relevant modules:**")
    for (const mod of shape.existingLandscape.relevantModules) {
      lines.push(`- ${mod}`)
    }
    lines.push("")
  }
  lines.push("## Technical Preferences")
  lines.push("")
  lines.push(`- **Error handling:** ${shape.technicalPreferences.errorHandling}`)
  lines.push(`- **Performance:** ${shape.technicalPreferences.performance}`)
  lines.push(`- **Security:** ${shape.technicalPreferences.security}`)
  lines.push(`- **Trade-offs:** ${shape.technicalPreferences.tradeoffs}`)
  lines.push(`- **Style:** ${shape.technicalPreferences.style}`)
  lines.push("")

  if (shape.runtime && typeof shape.runtime.devServerPort === "number") {
    lines.push("## Runtime")
    lines.push("")
    lines.push(`- **Dev server port:** ${shape.runtime.devServerPort}`)
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Parse the shape JSON, write shape.md, advance pipeline state, run shape
 * detection, and either chain to design (when visual shapes match) or print
 * the next-step hint. Shared by interactive `runShape` and `runShapeAuto`.
 */
const finalizeShape = async (
  buildName: string,
  buildDir: string,
  rawResult: string,
  opts: ShapeOptions & { interactive: boolean },
): Promise<void> => {
  let shapeOutput: ShapeOutput
  try {
    shapeOutput = JSON.parse(rawResult) as ShapeOutput
  } catch {
    printError("Failed to parse shape output as structured JSON")
    printError("Raw output will be written as-is")
    fs.writeFileSync(path.join(buildDir, "shape.md"), rawResult)
    advancePipeline(buildDir, buildName, "shape")
    return
  }

  const shapeMd = formatShapeMd(shapeOutput)
  fs.writeFileSync(path.join(buildDir, "shape.md"), shapeMd)
  advancePipeline(buildDir, buildName, "shape")

  const shapeMdContent = fs.readFileSync(path.join(buildDir, "shape.md"), "utf-8")
  const shapeDefinitions = loadShapeDefinitions()
  const matchedShapes = detectShapes(shapeMdContent, shapeDefinitions)

  const matchedNames = matchedShapes.map((s) => s.name)

  if (matchedShapes.length === 0) {
    console.log("")
    printInfo("Created:")
    console.log(`  ${path.join(buildDir, "shape.md")}`)
    console.log("")

    if (opts.interactive) {
      printInfo(`Next: ridgeline spec ${buildName}`)
      return
    }

    // Auto flow: design.md always runs (even for non-visual builds) so every
    // build has a consistent slot for visual data. The designer agent
    // produces a minimal "no visual surface" doc in this case.
    printInfo("No visual shape matched; running design (auto) for completeness.")
    console.log("")
    await runDesignAuto(buildName, {
      model: opts.model,
      timeout: opts.timeout,
      matchedShapes: [],
      inferGapFlagging: true,
    })
    return
  }

  recordMatchedShapes(buildDir, buildName, matchedNames)

  console.log("")
  printInfo("Created:")
  console.log(`  ${path.join(buildDir, "shape.md")}`)
  console.log("")
  printInfo(`Visual concerns detected: ${matchedNames.join(", ")}`)
  printInfo("Auto-chaining to design...")
  console.log("")

  if (opts.interactive) {
    await runDesign(buildName, {
      model: opts.model,
      timeout: opts.timeout,
      matchedShapes: matchedNames,
    })
  } else {
    await runDesignAuto(buildName, {
      model: opts.model,
      timeout: opts.timeout,
      matchedShapes: matchedNames,
      inferGapFlagging: true,
    })
  }
}

export const runShape = async (buildName: string, opts: ShapeOptions): Promise<void> => {
  const buildDir = resolveBuildDir(buildName, { ensure: true })
  printInfo(`Build directory: ${buildDir}`)

  const registry = buildAgentRegistry()
  const systemPrompt = registry.getCorePrompt("shaper.md")
  const timeoutMs = opts.timeout * 60 * 1000

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  try {
    const inputContext = await resolveInputContext(rl, opts.input)
    if (!inputContext) {
      printError("A description is required")
      return
    }

    // Intake turn — shaper analyzes codebase + user input
    const userPrompt = [
      `The user wants to create a new build called "${buildName}".`,
      "",
      "User-provided input:",
      inputContext,
      "",
      "Before asking questions, analyze the existing project directory using Read, Glob, and Grep tools to understand the codebase.",
      "Then respond with your questions, pre-filling suggestedAnswer for any questions you can answer from the code or the user's input.",
      "Remember: present ALL questions to the user even when pre-filled — the user has final say.",
    ].join("\n")

    // Intake + clarification loop
    const { sessionId, qa } = await runQAIntake(
      rl, systemPrompt, userPrompt,
      { model: opts.model, questionLabel: "I have a few questions" },
      timeoutMs, "Analyzing project and input...",
    )

    if (qa.summary) {
      console.log(`\nFinal understanding:\n  ${qa.summary}`)
    }

    const shapeResult = await runOutputTurn(
      systemPrompt,
      "Produce the final shape output now. Respond with ONLY the structured JSON shape document.",
      opts.model, timeoutMs, sessionId, "Producing shape document...", SHAPE_OUTPUT_SCHEMA,
    )

    await finalizeShape(buildName, buildDir, shapeResult.result, { ...opts, interactive: true })
  } finally {
    rl.close()
  }
}

type ShapeAutoOptions = ShapeOptions & {
  /** Pre-resolved source content. Required — callers must supply input. */
  inputContent: string
  /** Optional human-readable label for status output (e.g. file path). */
  inputLabel?: string
}

/**
 * Non-interactive shape: skip Q&A, infer reasonable defaults from the source
 * content + project, and produce shape.md in a single LLM call. Used by the
 * `ingest` command so users with a written-out PRD don't have to answer
 * back-and-forth questions.
 */
export const runShapeAuto = async (
  buildName: string,
  opts: ShapeAutoOptions,
): Promise<void> => {
  const buildDir = resolveBuildDir(buildName, { ensure: true })
  printInfo(`Build directory: ${buildDir}`)
  if (opts.inputLabel) {
    printInfo(`Using input from: ${opts.inputLabel}`)
  }

  const registry = buildAgentRegistry()
  const systemPrompt = registry.getCorePrompt("shaper.md")
  const timeoutMs = opts.timeout * 60 * 1000

  const userPrompt = [
    `The user wants to create a new build called "${buildName}".`,
    "",
    "Source material (authoritative — preserve its detail):",
    opts.inputContent,
    "",
    "Use Read, Glob, and Grep to analyze the existing project directory if useful.",
    "Then produce the final shape output as structured JSON.",
    "Do NOT ask questions. The user has chosen non-interactive ingest — make reasonable inferences where the source is silent.",
    "Where you infer a value the source did not state, prefix that field's content with `[inferred] ` so the user can spot it when reviewing shape.md.",
    "Respond with ONLY the structured JSON shape document.",
  ].join("\n")

  const result = await runOneShotCall({
    systemPrompt,
    userPrompt,
    model: opts.model,
    timeoutMs,
    allowedTools: ["Read", "Glob", "Grep"],
    jsonSchema: SHAPE_OUTPUT_SCHEMA,
    buildDir,
    statusMessage: "Producing shape document (non-interactive)...",
  })

  await finalizeShape(buildName, buildDir, result.result, { ...opts, interactive: false })
}
