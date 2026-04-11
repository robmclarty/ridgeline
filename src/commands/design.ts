import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import { printInfo } from "../ui/output"
import { invokeClaude } from "../engine/claude/claude.exec"
import { buildAgentRegistry } from "../engine/discovery/agent.registry"
import { resolveFlavour } from "../engine/discovery/flavour.resolve"
import { createDisplayCallbacks } from "../engine/claude/stream.display"
import { advancePipeline } from "../stores/state"

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

const askQuestion = (rl: readline.Interface, prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => {
      resolve(answer.trim())
    })
  })
}

/** Determine where to write design.md. */
export const resolveDesignOutputPath = (
  buildDir: string | null,
  ridgelineDir: string,
): string => {
  if (buildDir) return path.join(buildDir, "design.md")
  return path.join(ridgelineDir, "design.md")
}

export type DesignOptions = {
  model: string
  timeout: number
  flavour?: string
  matchedShapes?: string[]
}

export const runDesign = async (
  buildName: string | null,
  opts: DesignOptions
): Promise<void> => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = buildName
    ? path.join(ridgelineDir, "builds", buildName)
    : null

  const outputPath = resolveDesignOutputPath(buildDir, ridgelineDir)
  const timeoutMs = opts.timeout * 60 * 1000

  printInfo(buildDir ? `Build directory: ${buildDir}` : "Project-level design")

  const registry = buildAgentRegistry(resolveFlavour(opts.flavour ?? null))
  const systemPrompt = registry.getCorePrompt("designer.md")

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  try {
    // Gather existing context
    const contextParts: string[] = []

    const projectDesign = path.join(ridgelineDir, "design.md")
    if (fs.existsSync(projectDesign)) {
      contextParts.push("## Existing Project Design\n")
      contextParts.push(fs.readFileSync(projectDesign, "utf-8"))
      contextParts.push("")
    }

    if (buildDir) {
      const featureDesign = path.join(buildDir, "design.md")
      if (fs.existsSync(featureDesign)) {
        contextParts.push("## Existing Feature Design\n")
        contextParts.push(fs.readFileSync(featureDesign, "utf-8"))
        contextParts.push("")
      }

      const shapePath = path.join(buildDir, "shape.md")
      if (fs.existsSync(shapePath)) {
        contextParts.push("## shape.md\n")
        contextParts.push(fs.readFileSync(shapePath, "utf-8"))
        contextParts.push("")
      }
    }

    if (opts.matchedShapes && opts.matchedShapes.length > 0) {
      contextParts.push("## Matched Shape Categories\n")
      contextParts.push(opts.matchedShapes.join(", "))
      contextParts.push("")
    }

    const userPrompt = [
      buildName
        ? `Gather design system context for build "${buildName}".`
        : "Gather project-level design system context.",
      "",
      ...(contextParts.length > 0 ? contextParts : ["No existing design context found."]),
      "",
      "Analyze the context above and ask design-focused questions.",
      "Remember: present ALL questions to the user even when pre-filled.",
    ].join("\n")

    // Intake turn
    process.stderr.write(`\n\x1b[90mAnalyzing design context...\x1b[0m\n`)
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
    let sessionId = intakeResult.sessionId
    let qa = parseQAResponse(intakeResult.result)

    for (let round = 0; round < MAX_CLARIFICATION_ROUNDS && !qa.ready; round++) {
      if (qa.summary) {
        console.log(`\nDesign understanding so far:\n  ${qa.summary}`)
      }

      if (!qa.questions || qa.questions.length === 0) break

      const normalized = qa.questions.map(normalizeQuestion)
      console.log("\nDesign questions:\n")
      console.log(`  \x1b[90m(tip: you can enter a file path for longer answers)\x1b[0m\n`)
      const answers: string[] = []
      for (let i = 0; i < normalized.length; i++) {
        if (i > 0) console.log("")
        const q = normalized[i]
        if (q.suggestedAnswer) {
          console.log(`  ${i + 1}. ${q.question}`)
          console.log(`     \x1b[90m(suggested: ${q.suggestedAnswer})\x1b[0m`)
          const answer = await askQuestion(rl, `  > `)
          answers.push(answer || q.suggestedAnswer)
        } else {
          const answer = await askQuestion(rl, `  ${i + 1}. ${q.question}\n  > `)
          answers.push(answer)
        }
      }

      process.stderr.write(`\n\x1b[90mProcessing your answers...\x1b[0m\n`)
      const answersPrompt = normalized
        .map((q, i) => `Q: ${q.question}\nA: ${answers[i]}`)
        .join("\n\n")

      display = createDisplayCallbacks({ projectRoot: process.cwd() })
      const result = await invokeClaude({
        systemPrompt,
        userPrompt: `User answers to design questions:\n\n${answersPrompt}`,
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

    // Design output turn — no JSON schema, freeform markdown
    if (qa.summary) {
      console.log(`\nDesign summary:\n  ${qa.summary}`)
    }
    process.stderr.write(`\n\x1b[90mProducing design document...\x1b[0m\n`)

    display = createDisplayCallbacks({ projectRoot: process.cwd() })
    const designResult = await invokeClaude({
      systemPrompt,
      userPrompt: "Produce the final design document now. Respond with freeform markdown — NOT JSON. Structure it with headings, specific values (hard tokens), and directional guidance (soft guidance).",
      model: opts.model,
      cwd: process.cwd(),
      timeoutMs,
      sessionId,
      onStdout: display.onStdout,
    })
    display.flush()

    // Write design.md
    const designDir = path.dirname(outputPath)
    if (!fs.existsSync(designDir)) {
      fs.mkdirSync(designDir, { recursive: true })
    }
    fs.writeFileSync(outputPath, designResult.result)

    // Update pipeline state if in build context
    if (buildName && buildDir) {
      advancePipeline(buildDir, buildName, "design")
    }

    console.log("")
    printInfo("Created:")
    console.log(`  ${outputPath}`)
    console.log("")
    if (buildName) {
      printInfo(`Next: ridgeline spec ${buildName}`)
    }
  } finally {
    rl.close()
  }
}
