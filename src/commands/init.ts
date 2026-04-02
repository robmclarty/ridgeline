import * as fs from "node:fs"
import * as path from "node:path"
import { spawn } from "node:child_process"
import { logInfo } from "../logging"

const INIT_SYSTEM_PROMPT = `You are a project setup assistant for Ridgeline, a build harness for long-horizon software execution.

Your job is to help the user create the input files for a new build. Walk them through interactively.

## Step 1: spec.md
Ask the user to describe their feature or project in a few sentences. Then expand it into a structured spec with:
- A clear title
- An overview paragraph
- Features described as outcomes (what the system does), not implementation steps
- Any constraints or requirements the user mentions

Write the result to spec.md in the build directory. Let the user review and suggest edits.

## Step 2: constraints.md
Ask about their technical setup:
- Language and runtime (e.g., TypeScript/Node.js, Python, Go, Rust)
- Framework (e.g., Express, Next.js, FastAPI, none)
- Directory conventions
- Naming conventions (camelCase, snake_case, etc.)
- API style (REST, GraphQL, etc.)
- Database (if any)
- Key dependencies
- A check command that verifies the project builds and tests pass (e.g., "npm run build && npm test")

Structure the output as a markdown file with clear sections. Include a "## Check Command" section with the command in a fenced code block.

Write to constraints.md in the build directory.

## Step 3: taste.md (optional)
Ask if they have coding style preferences: commit message format, test patterns, comment style, etc.
If yes, write to taste.md. If no, skip.

Be conversational but efficient. Don't over-explain. Write files using the Write tool.`

export const runInit = async (buildName: string): Promise<void> => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = path.join(ridgelineDir, "builds", buildName)
  const phasesDir = path.join(buildDir, "phases")

  // Create directory structure
  fs.mkdirSync(phasesDir, { recursive: true })
  logInfo(`Created build directory: ${buildDir}`)

  // Check for existing project-level files
  const projectConstraints = path.join(ridgelineDir, "constraints.md")
  const projectTaste = path.join(ridgelineDir, "taste.md")

  let contextHint = ""
  if (fs.existsSync(projectConstraints)) {
    contextHint += `\nNote: Project-level constraints.md exists at ${projectConstraints}. Ask if the user wants to reuse it or create a build-specific override.\n`
  }
  if (fs.existsSync(projectTaste)) {
    contextHint += `\nNote: Project-level taste.md exists at ${projectTaste}. Ask if the user wants to reuse it or create a build-specific override.\n`
  }

  const systemPrompt = INIT_SYSTEM_PROMPT + contextHint +
    `\n\nWrite all files to: ${buildDir}/`

  logInfo("Starting interactive setup session...")
  logInfo("(This requires the claude CLI with an active subscription)\n")

  const proc = spawn("claude", [
    "--system-prompt", systemPrompt,
    "--allowedTools", "Write,Read",
  ], {
    cwd: process.cwd(),
    stdio: "inherit",
  })

  return new Promise<void>((resolve, reject) => {
    proc.on("close", (code) => {
      if (code === 0) {
        logInfo(`\nInit complete. Build files at: ${buildDir}`)
        logInfo(`Next: ridgeline plan ${buildName}`)
        resolve()
      } else {
        reject(new Error(`Init session exited with code ${code}`))
      }
    })
    proc.on("error", (err) => {
      reject(new Error(`Failed to start claude CLI: ${err.message}`))
    })
  })
}
