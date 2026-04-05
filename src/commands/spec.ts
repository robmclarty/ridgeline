import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import { printInfo, printError } from "../ui/output"
import { invokeClaude } from "../engine/claude/claude.exec"
import { resolveAgentPrompt } from "../engine/claude/agent.prompt"
import { createDisplayCallbacks } from "../engine/claude/stream.decode"

const MAX_CLARIFICATION_ROUNDS = 3

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
    // If JSON parsing fails, treat as ready with the text as summary
    return { ready: true, summary: resultText }
  }
}

export type SpecOptions = {
  model: string
  timeout: number
  input?: string
}

const resolveInput = (input: string): { type: "file"; path: string; content: string } | { type: "text"; content: string } => {
  // Check if it looks like a file path (has extension, starts with ./ or /, or contains path separators)
  const looksLikeFile = /\.\w+$/.test(input) || input.startsWith("/") || input.startsWith("./") || input.startsWith("../") || input.includes(path.sep)
  if (looksLikeFile) {
    const resolved = path.resolve(input)
    if (fs.existsSync(resolved)) {
      return { type: "file", path: resolved, content: fs.readFileSync(resolved, "utf-8") }
    }
  }
  return { type: "text", content: input }
}

const collectExistingFileHints = (ridgelineDir: string): string => {
  let hints = ""
  const projectConstraints = path.join(ridgelineDir, "constraints.md")
  const projectTaste = path.join(ridgelineDir, "taste.md")
  if (fs.existsSync(projectConstraints)) {
    hints += `\nNote: Project-level constraints.md exists at ${projectConstraints}. The user may want to reuse it rather than creating a new one.\n`
  }
  if (fs.existsSync(projectTaste)) {
    hints += `\nNote: Project-level taste.md exists at ${projectTaste}. The user may want to reuse it rather than creating a new one.\n`
  }
  return hints
}

const resolveInputContext = async (
  rl: readline.Interface,
  input?: string
): Promise<string | null> => {
  if (input) {
    const resolved = resolveInput(input)
    if (resolved.type === "file") {
      printInfo(`Using existing spec from: ${resolved.path}`)
    }
    return resolved.content
  }
  console.log("")
  const answer = await askQuestion(rl, "Describe what you want to build:\n> ")
  return answer || null
}

const runClarificationLoop = async (
  rl: readline.Interface,
  systemPrompt: string,
  opts: SpecOptions,
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

export const runSpec = async (buildName: string, opts: SpecOptions): Promise<void> => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = path.join(ridgelineDir, "builds", buildName)

  fs.mkdirSync(path.join(buildDir, "phases"), { recursive: true })
  printInfo(`Created build directory: ${buildDir}`)

  const existingFileHints = collectExistingFileHints(ridgelineDir)
  const systemPrompt = resolveAgentPrompt("specifier.md")
  const timeoutMs = opts.timeout * 60 * 1000

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  try {
    const inputContext = await resolveInputContext(rl, opts.input)
    if (!inputContext) {
      printError("A description is required")
      return
    }

    // Intake turn
    console.log("\nAnalyzing your input...")
    let userPrompt = `The user wants to create a new build called "${buildName}".\n\nUser-provided input:\n${inputContext}\n\nIf this input is detailed enough to answer all your questions, signal ready immediately and include a summary of what you understood. If you still have questions, include them — but for any question that the input already answers, include the question along with your best answer derived from the input so the user can confirm or correct.`
    if (existingFileHints) {
      userPrompt += `\n\n## Existing Project Files\n${existingFileHints}`
    }

    let display = createDisplayCallbacks({ projectRoot: process.cwd() })
    const intakeResult = await invokeClaude({
      systemPrompt,
      userPrompt,
      model: opts.model,
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

    // Generation turn
    if (qa.summary) {
      console.log(`\nFinal understanding:\n  ${qa.summary}`)
    }
    console.log("\nGenerating build files...")

    display = createDisplayCallbacks({ projectRoot: process.cwd() })
    await invokeClaude({
      systemPrompt,
      userPrompt: `Generate the build input files now. Write them to: ${buildDir}/\n\nUse the Write tool to create spec.md, constraints.md, and optionally taste.md in that directory.`,
      model: opts.model,
      allowedTools: ["Write", "Read", "Glob", "Grep"],
      cwd: process.cwd(),
      timeoutMs,
      sessionId,
      onStdout: display.onStdout,
    })
    display.flush()

    // Verify and report
    console.log("")
    const createdFiles = ["spec.md", "constraints.md", "taste.md"]
      .filter((f) => fs.existsSync(path.join(buildDir, f)))

    if (createdFiles.length === 0) {
      printError("No build files were created. Try running spec again.")
      return
    }

    printInfo("Created:")
    for (const f of createdFiles) {
      console.log(`  ${path.join(buildDir, f)}`)
    }

    if (!createdFiles.includes("spec.md")) {
      printError("Warning: spec.md was not created — this is required for planning")
    }
    if (!createdFiles.includes("constraints.md")) {
      printError("Warning: constraints.md was not created — this is required for planning")
    }

    console.log("")
    printInfo(`Next: ridgeline plan ${buildName}`)
  } finally {
    rl.close()
  }
}
