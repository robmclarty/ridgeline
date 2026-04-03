import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig, PhaseInfo, ClaudeResult } from "../types"
import { invokeClaude } from "./claudeInvoker"
import { createDisplayCallbacks } from "./streamParser"

const resolveAgentPrompt = (filename: string): string => {
  // Try dist/agents/ first (installed package), then src/agents/ (development)
  const distPath = path.join(__dirname, "agents", filename)
  if (fs.existsSync(distPath)) return fs.readFileSync(distPath, "utf-8")
  const srcPath = path.join(__dirname, "..", "agents", filename)
  if (fs.existsSync(srcPath)) return fs.readFileSync(srcPath, "utf-8")
  // Fallback: relative to project root
  const rootPath = path.join(__dirname, "..", "..", "src", "agents", filename)
  return fs.readFileSync(rootPath, "utf-8")
}

const assembleUserPrompt = (config: RidgelineConfig): string => {
  const sections: string[] = []

  const specPath = path.join(config.buildDir, "spec.md")
  sections.push("## spec.md\n")
  sections.push(fs.readFileSync(specPath, "utf-8"))
  sections.push("")

  sections.push("## constraints.md\n")
  sections.push(fs.readFileSync(config.constraintsPath, "utf-8"))
  sections.push("")

  if (config.tastePath) {
    sections.push("## taste.md\n")
    sections.push(fs.readFileSync(config.tastePath, "utf-8"))
    sections.push("")
  }

  if (fs.existsSync(config.snapshotPath)) {
    sections.push("## snapshot.md\n")
    sections.push(fs.readFileSync(config.snapshotPath, "utf-8"))
    sections.push("")
  }

  sections.push("## Target Model\n")
  sections.push(`The builder will use the \`${config.model}\` model.`)
  sections.push("")

  sections.push("## Output Directory\n")
  sections.push(`Write phase spec files to: ${config.phasesDir}`)
  sections.push("Use the naming convention: 01-<slug>.md, 02-<slug>.md, etc.")

  return sections.join("\n")
}

export const scanPhases = (phasesDir: string): PhaseInfo[] => {
  if (!fs.existsSync(phasesDir)) return []
  const files = fs.readdirSync(phasesDir)
    .filter((f) => /^\d{2}-.*\.md$/.test(f) && !f.includes(".feedback"))
    .sort()

  return files.map((filename) => {
    const match = filename.match(/^(\d{2})-(.+)\.md$/)
    return {
      id: filename.replace(/\.md$/, ""),
      index: match ? parseInt(match[1], 10) : 0,
      slug: match ? match[2] : filename,
      filename,
      filepath: path.join(phasesDir, filename),
    }
  })
}

export const invokePlanner = async (
  config: RidgelineConfig
): Promise<{ result: ClaudeResult; phases: PhaseInfo[] }> => {
  const systemPrompt = resolveAgentPrompt("planner.md")
  const userPrompt = assembleUserPrompt(config)
  const { onStdout, flush } = createDisplayCallbacks()

  const result = await invokeClaude({
    systemPrompt,
    userPrompt,
    model: config.model,
    allowedTools: ["Write"],
    cwd: process.cwd(),
    timeoutMs: config.timeoutMinutes * 60 * 1000,
    onStdout,
  })

  flush()

  // Scan for generated phase files
  const phases = scanPhases(config.phasesDir)

  if (phases.length === 0) {
    throw new Error("Planner did not generate any phase files")
  }

  return { result, phases }
}
