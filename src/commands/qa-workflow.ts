import * as readline from "node:readline"
import type { Engine } from "fascicle"
import { runClaudeOneShot } from "../engine/claude.runner.js"
import { makeRidgelineEngine } from "../engine/engine.factory.js"
import { resolveSandboxMode } from "../stores/settings.js"
import { createStreamDisplay } from "../ui/claude-stream-display.js"
import { hint } from "../ui/color.js"
import * as path from "node:path"

const ensureEngine = async <T>(
  engine: Engine | undefined,
  timeoutMs: number,
  fn: (engine: Engine) => Promise<T>,
): Promise<T> => {
  if (engine) return fn(engine)
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const inline = makeRidgelineEngine({
    sandboxFlag: resolveSandboxMode(ridgelineDir, undefined),
    timeoutMinutes: Math.max(1, Math.ceil(timeoutMs / 60_000)),
    pluginDirs: [],
    settingSources: ["user", "project", "local"],
    buildPath: process.cwd(),
  })
  try {
    return await fn(inline)
  } finally {
    await inline.dispose()
  }
}

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
  engine?: Engine
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
  process.stderr.write(`\n${hint(statusMessage, { stream: "stderr" })}\n`)
  return ensureEngine(opts.engine, timeoutMs, async (engine) => {
    const { onChunk, flush } = createStreamDisplay({ projectRoot: process.cwd() })
    let intakeResult
    try {
      intakeResult = await runClaudeOneShot({
        engine,
        model: opts.model,
        system: systemPrompt,
        prompt: userPrompt,
        allowedTools: ["Read", "Glob", "Grep"],
        outputJsonSchema: QA_JSON_SCHEMA,
        onChunk,
      })
    } finally {
      flush()
    }
    return runClarificationLoop(rl, systemPrompt, { ...opts, engine }, timeoutMs, {
      sessionId: intakeResult.sessionId,
      qa: parseQAResponse(intakeResult.result),
    })
  })
}

type OneShotOpts = {
  engine?: Engine
  systemPrompt: string
  userPrompt: string
  model: string
  timeoutMs: number
  allowedTools?: string[]
  jsonSchema?: string
  buildDir?: string
  statusMessage: string
}

/**
 * Single-call Claude invocation with the standard display callbacks. Used by
 * non-interactive paths (`runShapeAuto`, `runDesignAuto`) where there
 * is no resumable session — just one prompt, one output.
 */
export const runOneShotCall = async (
  opts: OneShotOpts,
): Promise<{ result: string; sessionId: string }> => {
  process.stderr.write(`\n${hint(opts.statusMessage, { stream: "stderr" })}\n`)
  return ensureEngine(opts.engine, opts.timeoutMs, async (engine) => {
    const { onChunk, flush } = createStreamDisplay({ projectRoot: process.cwd() })
    let result
    try {
      result = await runClaudeOneShot({
        engine,
        model: opts.model,
        system: opts.systemPrompt,
        prompt: opts.userPrompt,
        allowedTools: opts.allowedTools,
        outputJsonSchema: opts.jsonSchema,
        buildDir: opts.buildDir,
        onChunk,
      })
    } finally {
      flush()
    }
    return { result: result.result, sessionId: result.sessionId }
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
  engine?: Engine,
): Promise<{ result: string; sessionId: string }> => {
  process.stderr.write(`\n${hint(statusMessage, { stream: "stderr" })}\n`)
  return ensureEngine(engine, timeoutMs, async (resolved) => {
    const { onChunk, flush } = createStreamDisplay({ projectRoot: process.cwd() })
    let result
    try {
      result = await runClaudeOneShot({
        engine: resolved,
        model,
        system: systemPrompt,
        prompt: userPrompt,
        sessionId,
        outputJsonSchema: jsonSchema,
        onChunk,
      })
    } finally {
      flush()
    }
    return { result: result.result, sessionId: result.sessionId }
  })
}

const runClarificationLoop = async (
  rl: readline.Interface,
  systemPrompt: string,
  opts: QAOpts & { engine: Engine },
  _timeoutMs: number,
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
    console.log(`  ${hint("(tip: you can enter a file path for longer answers)")}\n`)
    const answers: string[] = []
    for (let i = 0; i < normalized.length; i++) {
      if (i > 0) console.log("")
      const q = normalized[i]
      if (q.suggestedAnswer) {
        console.log(`  ${i + 1}. ${q.question}`)
        console.log(`     ${hint(`(suggested: ${q.suggestedAnswer})`)}`)
        const answer = await askQuestion(rl, `  > `)
        answers.push(answer || q.suggestedAnswer)
      } else {
        const answer = await askQuestion(rl, `  ${i + 1}. ${q.question}\n  > `)
        answers.push(answer)
      }
    }

    process.stderr.write(`\n${hint("Processing your answers...", { stream: "stderr" })}\n`)
    const answersPrompt = normalized
      .map((q, i) => `Q: ${q.question}\nA: ${answers[i]}`)
      .join("\n\n")

    const { onChunk, flush } = createStreamDisplay({ projectRoot: process.cwd() })
    let result
    try {
      result = await runClaudeOneShot({
        engine: opts.engine,
        model: opts.model,
        system: systemPrompt,
        prompt: `User answers to follow-up questions:\n\n${answersPrompt}`,
        allowedTools: ["Read", "Glob", "Grep"],
        sessionId,
        outputJsonSchema: QA_JSON_SCHEMA,
        onChunk,
      })
    } finally {
      flush()
    }

    sessionId = result.sessionId
    qa = parseQAResponse(result.result)
  }

  return { sessionId, qa }
}
