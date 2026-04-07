import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import { printInfo, printError } from "../ui/output"
import { invokeClaude } from "../engine/claude/claude.exec"
import { buildAgentRegistry } from "../engine/discovery/agent.registry"
import { resolveFlavour } from "../engine/discovery/flavour.resolve"
import { createDisplayCallbacks } from "../engine/claude/stream.decode"
import { advancePipeline } from "../store/state"
import { resolveBuildDir } from "../config"

const MAX_CLARIFICATION_ROUNDS = 4

const QA_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    ready: { type: "boolean" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          suggestedAnswer: { type: "string" },
        },
        required: ["question"],
      },
    },
    summary: { type: "string" },
  },
  required: ["ready"],
})

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

const askQuestion = (rl: readline.Interface, prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => {
      resolve(answer.trim())
    })
  })
}

type QAQuestion = {
  question: string
  suggestedAnswer?: string
}

type QAResponse = {
  ready: boolean
  questions?: (string | QAQuestion)[]
  summary?: string
}

const normalizeQuestion = (q: string | QAQuestion): QAQuestion =>
  typeof q === "string" ? { question: q } : q

const parseQAResponse = (resultText: string): QAResponse => {
  try {
    return JSON.parse(resultText)
  } catch {
    return { ready: true, summary: resultText }
  }
}

export type ShapeOptions = {
  model: string
  timeout: number
  flavour?: string
  input?: string
}

const resolveInput = (input: string): { type: "file"; path: string; content: string } | { type: "text"; content: string } => {
  const looksLikeFile = /\.\w+$/.test(input) || input.startsWith("/") || input.startsWith("./") || input.startsWith("../") || input.includes(path.sep)
  if (looksLikeFile) {
    const resolved = path.resolve(input)
    if (fs.existsSync(resolved)) {
      return { type: "file", path: resolved, content: fs.readFileSync(resolved, "utf-8") }
    }
  }
  return { type: "text", content: input }
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

const runClarificationLoop = async (
  rl: readline.Interface,
  systemPrompt: string,
  opts: ShapeOptions,
  timeoutMs: number,
  initialResult: { sessionId: string; qa: QAResponse }
): Promise<{ sessionId: string; qa: QAResponse }> => {
  let { sessionId, qa } = initialResult

  for (let round = 0; round < MAX_CLARIFICATION_ROUNDS && !qa.ready; round++) {
    if (qa.summary) {
      console.log(`\nHere's what I understand so far:\n  ${qa.summary}`)
    }

    if (!qa.questions || qa.questions.length === 0) break

    const normalized = qa.questions.map(normalizeQuestion)
    console.log("\nI have a few questions:\n")
    const answers: string[] = []
    for (let i = 0; i < normalized.length; i++) {
      const q = normalized[i]
      if (q.suggestedAnswer) {
        console.log(`  ${i + 1}. ${q.question}`)
        console.log(`     (suggested: ${q.suggestedAnswer})`)
        const answer = await askQuestion(rl, `  > `)
        answers.push(answer || q.suggestedAnswer)
      } else {
        const answer = await askQuestion(rl, `  ${i + 1}. ${q.question}\n  > `)
        answers.push(answer)
      }
    }

    console.log("\nProcessing your answers...")
    const answersPrompt = normalized
      .map((q, i) => `Q: ${q.question}\nA: ${answers[i]}`)
      .join("\n\n")

    const display = createDisplayCallbacks({ projectRoot: process.cwd() })
    const result = await invokeClaude({
      systemPrompt,
      userPrompt: `User answers to follow-up questions:\n\n${answersPrompt}`,
      model: opts.model,
      allowedTools: ["Read", "Glob", "Grep"],
      cwd: process.cwd(),
      timeoutMs,
      sessionId,
      jsonSchema: QA_JSON_SCHEMA,
      onStdout: display.onStdout,
    })
    display.flush()

    sessionId = result.sessionId
    qa = parseQAResponse(result.result)
  }

  return { sessionId, qa }
}

export const runShape = async (buildName: string, opts: ShapeOptions): Promise<void> => {
  const buildDir = resolveBuildDir(buildName, { ensure: true })
  printInfo(`Build directory: ${buildDir}`)

  const registry = buildAgentRegistry(resolveFlavour(opts.flavour ?? null))
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
    console.log("\nAnalyzing project and input...")
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

    let display = createDisplayCallbacks({ projectRoot: process.cwd() })
    const intakeResult = await invokeClaude({
      systemPrompt,
      userPrompt,
      model: opts.model,
      allowedTools: ["Read", "Glob", "Grep"],
      cwd: process.cwd(),
      timeoutMs,
      jsonSchema: QA_JSON_SCHEMA,
      onStdout: display.onStdout,
    })
    display.flush()

    // Clarification loop
    const { sessionId, qa } = await runClarificationLoop(rl, systemPrompt, opts, timeoutMs, {
      sessionId: intakeResult.sessionId,
      qa: parseQAResponse(intakeResult.result),
    })

    // Shape output turn
    if (qa.summary) {
      console.log(`\nFinal understanding:\n  ${qa.summary}`)
    }
    console.log("\nProducing shape document...")

    display = createDisplayCallbacks({ projectRoot: process.cwd() })
    const shapeResult = await invokeClaude({
      systemPrompt,
      userPrompt: "Produce the final shape output now. Respond with ONLY the structured JSON shape document.",
      model: opts.model,
      cwd: process.cwd(),
      timeoutMs,
      sessionId,
      jsonSchema: SHAPE_OUTPUT_SCHEMA,
      onStdout: display.onStdout,
    })
    display.flush()

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

    console.log("")
    printInfo("Created:")
    console.log(`  ${path.join(buildDir, "shape.md")}`)
    console.log("")
    printInfo(`Next: ridgeline spec ${buildName}`)
  } finally {
    rl.close()
  }
}
