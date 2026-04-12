import * as fs from "node:fs"
import * as path from "node:path"
import { printInfo, printError } from "../ui/output"
import { invokeClaude } from "../engine/claude/claude.exec"
import { createDisplayCallbacks } from "../engine/claude/stream.display"
import { buildAgentRegistry } from "../engine/discovery/agent.registry"
import { resolveFlavour } from "../engine/discovery/flavour.resolve"
import { loadBudget } from "../stores/budget"
import { readTrajectory } from "../stores/trajectory"
import { loadState } from "../stores/state"

type RetrospectiveOpts = {
  model: string
  timeout: number
  flavour?: string
}

const assembleUserPrompt = (buildDir: string, buildName: string): string => {
  const sections: string[] = []

  // Trajectory
  const trajectory = readTrajectory(buildDir)
  if (trajectory.length > 0) {
    sections.push("## trajectory.jsonl\n")
    sections.push(trajectory.map((e) => JSON.stringify(e)).join("\n"))
    sections.push("")
  }

  // Budget
  const budget = loadBudget(buildDir)
  sections.push("## budget.json\n")
  sections.push(JSON.stringify(budget, null, 2))
  sections.push("")

  // State
  const state = loadState(buildDir)
  if (state) {
    sections.push("## state.json\n")
    sections.push(JSON.stringify(state, null, 2))
    sections.push("")
  }

  // Feedback files
  const phasesDir = path.join(buildDir, "phases")
  if (fs.existsSync(phasesDir)) {
    const feedbackFiles = fs.readdirSync(phasesDir).filter((f) => f.includes("feedback"))
    for (const file of feedbackFiles) {
      sections.push(`## ${file}\n`)
      sections.push(fs.readFileSync(path.join(phasesDir, file), "utf-8"))
      sections.push("")
    }
  }

  // Learnings output path
  const ridgelineDir = path.dirname(buildDir)
  const learningsPath = path.join(ridgelineDir, "..", "learnings.md")
  sections.push("## Output Instructions\n")
  sections.push(`Append your retrospective to: ${learningsPath}`)
  sections.push(`Build name: ${buildName}`)
  sections.push(`Date: ${new Date().toISOString().split("T")[0]}`)
  sections.push("")

  return sections.join("\n")
}

export const runRetrospective = async (
  buildName: string,
  opts: RetrospectiveOpts,
): Promise<void> => {
  const buildDir = path.join(process.cwd(), ".ridgeline", "builds", buildName)

  if (!fs.existsSync(buildDir)) {
    printError(`Build directory not found: ${buildDir}`)
    return
  }

  const registry = buildAgentRegistry(resolveFlavour(opts.flavour ?? null))
  const systemPrompt = registry.getCorePrompt("retrospective.md")
  const userPrompt = assembleUserPrompt(buildDir, buildName)
  const { onStdout, flush } = createDisplayCallbacks({ projectRoot: process.cwd() })

  printInfo(`Running retrospective for build '${buildName}'...`)

  try {
    await invokeClaude({
      systemPrompt,
      userPrompt,
      model: opts.model,
      allowedTools: ["Read", "Write", "Glob", "Grep"],
      cwd: process.cwd(),
      timeoutMs: opts.timeout * 60 * 1000,
      onStdout,
    })
    printInfo("Retrospective complete. Learnings appended to .ridgeline/learnings.md")
  } catch (err) {
    printError(`Retrospective failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    flush()
  }
}
