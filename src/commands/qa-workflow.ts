import * as readline from "node:readline"
import { invokeClaude } from "../engine/claude/claude.exec"
import { createDisplayCallbacks } from "../engine/claude/stream.display"

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

export const normalizeQuestion = (q: string | QAQuestion): QAQuestion =>
  typeof q === "string" ? { question: q } : q

export const parseQAResponse = (resultText: string): QAResponse => {
  try {
    return JSON.parse(resultText)
  } catch {
    return { ready: true, summary: resultText }
  }
}

export const askQuestion = (rl: readline.Interface, prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => {
      resolve(answer.trim())
    })
  })
}

type QAOpts = {
  model: string
  questionLabel?: string
}

/**
 * Run the QA intake turn — invoke Claude with the QA JSON schema to gather
 * initial questions, then run the clarification loop until ready.
 */
export const runQAIntake = async (
  rl: readline.Interface,
  systemPrompt: string,
  userPrompt: string,
  opts: QAOpts,
  timeoutMs: number,
  statusMessage: string,
): Promise<{ sessionId: string; qa: QAResponse }> => {
  process.stderr.write(`\n\x1b[90m${statusMessage}\x1b[0m\n`)
  const display = createDisplayCallbacks({ projectRoot: process.cwd() })
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

  return runClarificationLoop(rl, systemPrompt, opts, timeoutMs, {
    sessionId: intakeResult.sessionId,
    qa: parseQAResponse(intakeResult.result),
  })
}

/**
 * Run the output turn — invoke Claude for the final output (no QA schema).
 */
export const runOutputTurn = async (
  systemPrompt: string,
  userPrompt: string,
  model: string,
  timeoutMs: number,
  sessionId: string,
  statusMessage: string,
  jsonSchema?: string,
): Promise<{ result: string; sessionId: string }> => {
  process.stderr.write(`\n\x1b[90m${statusMessage}\x1b[0m\n`)
  const display = createDisplayCallbacks({ projectRoot: process.cwd() })
  const result = await invokeClaude({
    systemPrompt,
    userPrompt,
    model,
    cwd: process.cwd(),
    timeoutMs,
    sessionId,
    jsonSchema,
    onStdout: display.onStdout,
  })
  display.flush()
  return { result: result.result, sessionId: result.sessionId }
}

const runClarificationLoop = async (
  rl: readline.Interface,
  systemPrompt: string,
  opts: QAOpts,
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
    const label = opts.questionLabel ?? "Questions"
    console.log(`\n${label}:\n`)
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
