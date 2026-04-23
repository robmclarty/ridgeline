import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import { printInfo, printError } from "../ui/output"
import { buildAgentRegistry } from "../engine/discovery/agent.registry"
import { advancePipeline, recordMatchedShapes } from "../stores/state"
import { resolveBuildDir } from "../config"
import { loadShapeDefinitions, detectShapes } from "../shapes/detect"
import { runDesign } from "./design"
import { askQuestion, runQAIntake, runOutputTurn } from "./qa-workflow"
import { resolveInput } from "./input"

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
}

export type ShapeOptions = {
  model: string
  timeout: number
  flavour?: string
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
const formatShapeMd = (shape: ShapeOutput): string => {
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

  return lines.join("\n")
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

    // Shape output turn
    if (qa.summary) {
      console.log(`\nFinal understanding:\n  ${qa.summary}`)
    }

    const shapeResult = await runOutputTurn(
      systemPrompt,
      "Produce the final shape output now. Respond with ONLY the structured JSON shape document.",
      opts.model, timeoutMs, sessionId, "Producing shape document...", SHAPE_OUTPUT_SCHEMA,
    )

    // Parse and write shape.md
    let shapeOutput: ShapeOutput
    try {
      shapeOutput = JSON.parse(shapeResult.result) as ShapeOutput
    } catch {
      printError("Failed to parse shape output as structured JSON")
      printError("Raw output will be written as-is")
      fs.writeFileSync(path.join(buildDir, "shape.md"), shapeResult.result)
      advancePipeline(buildDir, buildName, "shape")
      return
    }

    const shapeMd = formatShapeMd(shapeOutput)
    fs.writeFileSync(path.join(buildDir, "shape.md"), shapeMd)

    // Update pipeline state
    advancePipeline(buildDir, buildName, "shape")

    // --- Shape detection ---
    const shapeMdContent = fs.readFileSync(path.join(buildDir, "shape.md"), "utf-8")
    const shapeDefinitions = loadShapeDefinitions()
    const matchedShapes = detectShapes(shapeMdContent, shapeDefinitions)

    if (matchedShapes.length > 0) {
      const matchedNames = matchedShapes.map((s) => s.name)
      recordMatchedShapes(buildDir, buildName, matchedNames)

      console.log("")
      printInfo("Created:")
      console.log(`  ${path.join(buildDir, "shape.md")}`)
      console.log("")
      printInfo(`Visual concerns detected: ${matchedNames.join(", ")}`)
      printInfo("Auto-chaining to design...")
      console.log("")

      // Auto-chain to design command within the same build context
      await runDesign(buildName, {
        model: opts.model,
        timeout: opts.timeout,
        flavour: opts.flavour,
        matchedShapes: matchedNames,
      })
    } else {
      console.log("")
      printInfo("Created:")
      console.log(`  ${path.join(buildDir, "shape.md")}`)
      console.log("")
      printInfo(`Next: ridgeline spec ${buildName}`)
    }
  } finally {
    rl.close()
  }
}
