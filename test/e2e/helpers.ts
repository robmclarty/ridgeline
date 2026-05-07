import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { RidgelineConfig } from "../../src/types.js"

const SPEC_CONTENT = `# Hello World

Create a simple Node.js script called \`hello.js\` that:

1. Defines a function \`greet(name)\` that returns \`"Hello, <name>!"\`.
2. Exports the function.
3. When run directly (not imported), prints \`greet("World")\` to stdout.
`

const CONSTRAINTS_CONTENT = `# Constraints

- Language: JavaScript (Node.js, no dependencies)
- No TypeScript, no build step

## Check Command

\`\`\`bash
node hello.js
\`\`\`
`

export const isClaudeAvailable = (): boolean => {
  try {
    execSync("claude --version", { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

export const setupE2eDir = (): { dir: string; config: RidgelineConfig; cleanup: () => void } => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "ridgeline-e2e-"))

  const ridgelineDir = path.join(dir, ".ridgeline")
  const buildDir = path.join(ridgelineDir, "builds", "hello")
  const phasesDir = path.join(buildDir, "phases")

  // Create directory structure
  fs.mkdirSync(phasesDir, { recursive: true })

  // Write spec and constraints
  fs.writeFileSync(path.join(buildDir, "spec.md"), SPEC_CONTENT)
  fs.writeFileSync(path.join(buildDir, "constraints.md"), CONSTRAINTS_CONTENT)

  // Initialize a real git repo (pipeline needs tags, diffs, checkpoints)
  execSync("git init", { cwd: dir, stdio: "pipe" })
  execSync("git add -A", { cwd: dir, stdio: "pipe" })
  execSync('git commit -m "init"', { cwd: dir, stdio: "pipe" })

  const config: RidgelineConfig = {
    buildName: "hello",
    ridgelineDir,
    buildDir,
    constraintsPath: path.join(buildDir, "constraints.md"),
    tastePath: null,
    handoffPath: path.join(buildDir, "handoff.md"),
    phasesDir,
    model: "sonnet",
    maxRetries: 1,
    timeoutMinutes: 5,
    checkTimeoutSeconds: 30,
    checkCommand: "node hello.js",
    maxBudgetUsd: 5,
    unsafe: false,
    sandboxMode: "semi-locked",
    sandboxExtras: { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
    networkAllowlist: [],
    extraContext: null,
    specialistCount: 2,
    specialistTimeoutSeconds: 180,
    phaseBudgetLimit: 15,
    phaseTokenLimit: 80000,
    requirePhaseApproval: false,
  }

  const cleanup = () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }

  return { dir, config, cleanup }
}
