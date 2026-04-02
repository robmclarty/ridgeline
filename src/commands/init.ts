import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import { logInfo, logError } from "../logging"
import { invokeClaude } from "../runner/claudeInvoker"
import { generateSnapshot } from "../state/snapshot"

const MAX_CLARIFICATION_ROUNDS = 3

const QA_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    ready: { type: "boolean" },
    questions: {
      type: "array",
      items: { type: "string" },
    },
    summary: { type: "string" },
  },
  required: ["ready"],
})

const resolveAgentPrompt = (filename: string): string => {
  const distPath = path.join(__dirname, "agents", filename)
  if (fs.existsSync(distPath)) return fs.readFileSync(distPath, "utf-8")
  const srcPath = path.join(__dirname, "..", "agents", filename)
  if (fs.existsSync(srcPath)) return fs.readFileSync(srcPath, "utf-8")
  throw new Error(`Agent prompt not found: ${filename}`)
}

const askQuestion = (rl: readline.Interface, prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => {
      resolve(answer.trim())
    })
  })
}

type QAResponse = {
  ready: boolean
  questions?: string[]
  summary?: string
}

const parseQAResponse = (resultText: string): QAResponse => {
  try {
    return JSON.parse(resultText)
  } catch {
    // If JSON parsing fails, treat as ready with the text as summary
    return { ready: true, summary: resultText }
  }
}

export type InitOptions = {
  model: string
  verbose: boolean
  timeout: number
}

export const runInit = async (buildName: string, opts: InitOptions): Promise<void> => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = path.join(ridgelineDir, "builds", buildName)
  const phasesDir = path.join(buildDir, "phases")

  // Create directory structure
  fs.mkdirSync(phasesDir, { recursive: true })
  logInfo(`Created build directory: ${buildDir}`)

  // Generate codebase snapshot if project has existing code
  let snapshot = ""
  const hasExistingCode = fs.readdirSync(process.cwd()).some(
    (f) => !f.startsWith(".") && f !== "node_modules" && f !== ".ridgeline"
  )
  if (hasExistingCode) {
    snapshot = generateSnapshot(process.cwd(), buildDir)
    logInfo("Generated codebase snapshot")
  }

  // Check for existing project-level files
  const projectConstraints = path.join(ridgelineDir, "constraints.md")
  const projectTaste = path.join(ridgelineDir, "taste.md")
  let existingFileHints = ""
  if (fs.existsSync(projectConstraints)) {
    existingFileHints += `\nNote: Project-level constraints.md exists at ${projectConstraints}. The user may want to reuse it rather than creating a new one.\n`
  }
  if (fs.existsSync(projectTaste)) {
    existingFileHints += `\nNote: Project-level taste.md exists at ${projectTaste}. The user may want to reuse it rather than creating a new one.\n`
  }

  const systemPrompt = resolveAgentPrompt("init.md")
  const timeoutMs = opts.timeout * 60 * 1000

  // Set up readline for user interaction
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    // Step 1: Get initial description from user
    console.log("")
    const description = await askQuestion(rl, "Describe what you want to build:\n> ")
    if (!description) {
      logError("A description is required")
      return
    }

    // Step 2: Intake turn — send description to Claude
    console.log("\nAnalyzing your description...")
    let userPrompt = `The user wants to create a new build called "${buildName}".\n\nUser description:\n${description}`
    if (snapshot) {
      userPrompt += `\n\n## Existing Codebase Snapshot\n${snapshot}`
    }
    if (existingFileHints) {
      userPrompt += `\n\n## Existing Project Files\n${existingFileHints}`
    }

    let result = await invokeClaude({
      systemPrompt,
      userPrompt,
      model: opts.model,
      cwd: process.cwd(),
      verbose: opts.verbose,
      timeoutMs,
      jsonSchema: QA_JSON_SCHEMA,
    })

    let sessionId = result.sessionId
    let qa = parseQAResponse(result.result)

    // Step 3: Clarification loop
    for (let round = 0; round < MAX_CLARIFICATION_ROUNDS && !qa.ready; round++) {
      // Display summary if present
      if (qa.summary) {
        console.log(`\nHere's what I understand so far:\n  ${qa.summary}`)
      }

      // Display and collect answers to questions
      if (qa.questions && qa.questions.length > 0) {
        console.log("\nI have a few questions:\n")
        const answers: string[] = []
        for (let i = 0; i < qa.questions.length; i++) {
          const answer = await askQuestion(rl, `  ${i + 1}. ${qa.questions[i]}\n  > `)
          answers.push(answer)
        }

        // Send answers back to Claude
        console.log("\nProcessing your answers...")
        const answersPrompt = qa.questions
          .map((q, i) => `Q: ${q}\nA: ${answers[i]}`)
          .join("\n\n")

        result = await invokeClaude({
          systemPrompt,
          userPrompt: `User answers to follow-up questions:\n\n${answersPrompt}`,
          model: opts.model,
          cwd: process.cwd(),
          verbose: opts.verbose,
          timeoutMs,
          sessionId,
          jsonSchema: QA_JSON_SCHEMA,
        })

        sessionId = result.sessionId
        qa = parseQAResponse(result.result)
      } else {
        // No questions but not ready — shouldn't happen, but break to avoid infinite loop
        break
      }
    }

    // Step 4: Generation turn
    if (qa.summary) {
      console.log(`\nFinal understanding:\n  ${qa.summary}`)
    }
    console.log("\nGenerating build files...")

    await invokeClaude({
      systemPrompt,
      userPrompt: `Generate the build input files now. Write them to: ${buildDir}/\n\nUse the Write tool to create spec.md, constraints.md, and optionally taste.md in that directory.`,
      model: opts.model,
      allowedTools: ["Write", "Read", "Glob", "Grep"],
      cwd: process.cwd(),
      verbose: opts.verbose,
      timeoutMs,
      sessionId,
    })

    // Step 5: Verify and report
    console.log("")
    const createdFiles: string[] = []
    for (const filename of ["spec.md", "constraints.md", "taste.md"]) {
      if (fs.existsSync(path.join(buildDir, filename))) {
        createdFiles.push(filename)
      }
    }

    if (createdFiles.length === 0) {
      logError("No build files were created. Try running init again.")
      return
    }

    logInfo("Created:")
    for (const f of createdFiles) {
      console.log(`  ${path.join(buildDir, f)}`)
    }

    if (!createdFiles.includes("spec.md")) {
      logError("Warning: spec.md was not created — this is required for planning")
    }
    if (!createdFiles.includes("constraints.md")) {
      logError("Warning: constraints.md was not created — this is required for planning")
    }

    console.log("")
    logInfo(`Next: ridgeline plan ${buildName}`)
  } finally {
    rl.close()
  }
}
