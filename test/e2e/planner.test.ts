import { describe, it, expect, afterAll } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { isClaudeAvailable } from "./helpers"
import { invokeClaude } from "../../src/engine/claude/claude.exec"
import { extractResult } from "../../src/engine/claude/stream.result"
import { spawn } from "node:child_process"

/**
 * E2E test for the planner specialist pipeline.
 *
 * Invokes a single specialist via the Claude CLI with --json-schema to
 * inspect the raw stream-json output and verify that structured JSON
 * proposals are returned correctly.
 */

const TINY_SPEC = `# Counter CLI

A command-line tool that prints numbers from 1 to N.
Accepts a single positional argument (the count).
Prints one number per line to stdout.
`

const TINY_CONSTRAINTS = `# Constraints

- Language: JavaScript (Node.js, no dependencies)
- No TypeScript, no build step

## Check Command

\`\`\`bash
node counter.js 5
\`\`\`
`

const PROPOSAL_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    perspective: { type: "string" },
    summary: { type: "string" },
    phases: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          slug: { type: "string" },
          goal: { type: "string" },
          acceptanceCriteria: {
            type: "array",
            items: { type: "string" },
          },
          specReference: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["title", "slug", "goal", "acceptanceCriteria", "specReference", "rationale"],
      },
    },
    tradeoffs: { type: "string" },
  },
  required: ["perspective", "summary", "phases", "tradeoffs"],
})

const SYSTEM_PROMPT = `You are a planning specialist. Your perspective is simplicity.

Decompose the given spec into sequential build phases. Return your plan as a single JSON object.

Do NOT use the Write tool. Do NOT produce markdown. Do NOT write prose or commentary.
Your entire response must be valid JSON matching the provided schema.

Each phase in your JSON must include:
- title: Phase name
- slug: Kebab-case identifier for file naming
- goal: 1-3 paragraphs describing what this phase accomplishes
- acceptanceCriteria: Array of concrete, verifiable outcomes
- specReference: Relevant spec sections
- rationale: Why this phase boundary exists

Also include your perspective label, a summary of your approach, and the tradeoffs of your plan.`

const USER_PROMPT = `## spec.md

${TINY_SPEC}

## constraints.md

${TINY_CONSTRAINTS}

## Target Model

The builder will use the \`sonnet\` model.

IMPORTANT: Respond with ONLY a JSON object. No prose, no markdown, no commentary. Just the JSON.`

describe.skipIf(!isClaudeAvailable())("e2e: planner specialist", () => {
  let tmpDir: string

  afterAll(() => {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    }
  })

  it("returns structured JSON via --json-schema", async () => {
    tmpDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "ridgeline-planner-e2e-"))

    // Invoke Claude directly with --json-schema
    const result = await invokeClaude({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: USER_PROMPT,
      model: "sonnet",
      allowedTools: [],
      cwd: tmpDir,
      timeoutMs: 120_000,
      jsonSchema: PROPOSAL_SCHEMA,
    })

    console.log("\n=== ClaudeResult fields ===")
    console.log("success:", result.success)
    console.log("result length:", result.result.length)
    console.log("result repr:", JSON.stringify(result.result).slice(0, 500))
    console.log("costUsd:", result.costUsd)
    console.log("durationMs:", result.durationMs)

    // Log regardless of outcome so we can diagnose
    if (result.result.length === 0) {
      console.log("\n=== result.result is EMPTY — fallback did not fire ===")
      console.log("This means assistant text events were not collected by extractResult")
    }

    // The result should be non-empty
    expect(result.result.length).toBeGreaterThan(0)

    // It should be parseable as JSON
    let proposal: Record<string, unknown>
    try {
      proposal = JSON.parse(result.result)
    } catch {
      // If direct parse fails, log and try extraction
      console.log("\n=== Direct JSON.parse failed, trying extraction ===")
      console.log("Full result:", result.result)
      throw new Error(`result.result is not valid JSON: ${result.result.slice(0, 200)}`)
    }

    console.log("\n=== Parsed proposal ===")
    console.log("perspective:", proposal.perspective)
    console.log("summary:", proposal.summary)
    console.log("phases:", (proposal.phases as unknown[])?.length)
    console.log("tradeoffs:", proposal.tradeoffs)

    // Validate structure
    expect(proposal.perspective).toBeDefined()
    expect(proposal.summary).toBeDefined()
    expect(proposal.phases).toBeDefined()
    expect(Array.isArray(proposal.phases)).toBe(true)
    expect((proposal.phases as unknown[]).length).toBeGreaterThanOrEqual(1)
    expect(proposal.tradeoffs).toBeDefined()
  })

  it("captures raw stream-json events for inspection", async () => {
    tmpDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "ridgeline-planner-raw-"))

    // Spawn claude directly to capture the raw NDJSON output
    const rawOutput = await new Promise<string>((resolve, reject) => {
      const args = [
        "-p",
        "--output-format", "stream-json",
        "--model", "sonnet",
        "--verbose",
        "--json-schema", PROPOSAL_SCHEMA,
        "--system-prompt", SYSTEM_PROMPT,
      ]

      const proc = spawn("claude", args, {
        cwd: tmpDir,
        stdio: ["pipe", "pipe", "pipe"],
      })

      let stdout = ""
      let stderr = ""

      proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
      proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString() })

      const timer = setTimeout(() => {
        proc.kill("SIGTERM")
        reject(new Error("Timed out after 120s"))
      }, 120_000)

      proc.on("close", (code) => {
        clearTimeout(timer)
        if (!stdout.trim()) {
          reject(new Error(`claude exited ${code}, stderr: ${stderr}`))
          return
        }
        resolve(stdout)
      })

      proc.stdin?.write(USER_PROMPT)
      proc.stdin?.end()
    })

    // Parse and log each event type
    const lines = rawOutput.trim().split("\n")
    const events: Array<{ type: string; [k: string]: unknown }> = []

    console.log(`\n=== Raw stream: ${lines.length} lines ===`)
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        events.push(parsed)

        if (parsed.type === "result") {
          console.log("\n=== Result event ===")
          console.log("result field type:", typeof parsed.result)
          console.log("result field value:", JSON.stringify(parsed.result)?.slice(0, 300))
          console.log("is_error:", parsed.is_error)
        } else if (parsed.type === "assistant") {
          if (parsed.subtype === "text") {
            console.log(`[assistant/text] ${(parsed.text as string)?.slice(0, 100)}...`)
          } else if (parsed.message) {
            const content = (parsed.message as Record<string, unknown>).content as unknown[]
            if (Array.isArray(content)) {
              for (const block of content) {
                const b = block as Record<string, unknown>
                if (b.type === "text") {
                  console.log(`[assistant/message/text] ${(b.text as string)?.slice(0, 200)}...`)
                } else if (b.type === "thinking") {
                  console.log(`[assistant/message/thinking] ${(b.thinking as string)?.slice(0, 200)}...`)
                } else if (b.type === "tool_use") {
                  console.log(`[assistant/message/tool_use] name=${b.name}, input=${JSON.stringify(b.input)?.slice(0, 300)}`)
                } else {
                  console.log(`[assistant/message/${b.type}] ${JSON.stringify(b).slice(0, 200)}`)
                }
              }
            }
          }
        } else {
          console.log(`[${parsed.type}]`)
        }
      } catch {
        console.log(`[unparseable] ${line.slice(0, 80)}`)
      }
    }

    // Verify extractResult can produce a result from this raw output
    const extracted = extractResult(rawOutput)
    console.log("\n=== extractResult output ===")
    console.log("result length:", extracted.result.length)
    console.log("result (first 300):", extracted.result.slice(0, 300))

    expect(extracted.result.length).toBeGreaterThan(0)
  })
})
