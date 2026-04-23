import * as fs from "node:fs"
import * as path from "node:path"
import { printInfo, printError, printWarn } from "../ui/output"
import { invokeClaude } from "../engine/claude/claude.exec"
import { createDisplayCallbacks } from "../engine/claude/stream.display"
import { buildAgentRegistry } from "../engine/discovery/agent.registry"
import { loadBudget } from "../stores/budget"
import { readTrajectory } from "../stores/trajectory"
import { loadState } from "../stores/state"

type RetrospectiveOpts = {
  model: string
  timeout: number
}

const assembleUserPrompt = (buildDir: string, buildName: string): string => {
  const sections: string[] = []

  const trajectory = readTrajectory(buildDir)
  if (trajectory.length > 0) {
    sections.push("## trajectory.jsonl\n")
    sections.push(trajectory.map((e) => JSON.stringify(e)).join("\n"))
    sections.push("")
  }

  const budget = loadBudget(buildDir)
  sections.push("## budget.json\n")
  sections.push(JSON.stringify(budget, null, 2))
  sections.push("")

  const state = loadState(buildDir)
  if (state) {
    sections.push("## state.json\n")
    sections.push(JSON.stringify(state, null, 2))
    sections.push("")
  }

  const phasesDir = path.join(buildDir, "phases")
  if (fs.existsSync(phasesDir)) {
    const feedbackFiles = fs.readdirSync(phasesDir).filter((f) => f.includes("feedback"))
    for (const file of feedbackFiles) {
      sections.push(`## ${file}\n`)
      sections.push(fs.readFileSync(path.join(phasesDir, file), "utf-8"))
      sections.push("")
    }
  }

  sections.push("## Context\n")
  sections.push(`Build name: ${buildName}`)
  sections.push(`Date: ${new Date().toISOString().split("T")[0]}`)
  sections.push("")

  return sections.join("\n")
}

const isWellFormedRetrospective = (text: string): boolean => {
  return /^\s*##\s+Build:/m.test(text)
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

  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const learningsPath = path.join(ridgelineDir, "learnings.md")

  const registry = buildAgentRegistry()
  const systemPrompt = registry.getCorePrompt("retrospective.md")
  const userPrompt = assembleUserPrompt(buildDir, buildName)
  const { onStdout, flush } = createDisplayCallbacks({ projectRoot: process.cwd() })

  printInfo(`Running retrospective for build '${buildName}'...`)

  try {
    const result = await invokeClaude({
      systemPrompt,
      userPrompt,
      model: opts.model,
      allowedTools: ["Read", "Glob", "Grep", "Skill"],
      cwd: process.cwd(),
      timeoutMs: opts.timeout * 60 * 1000,
      onStdout,
    })

    const body = result.result?.trim() ?? ""

    if (!body) {
      printWarn("Retrospective produced empty output; learnings.md not updated.")
      return
    }

    if (!isWellFormedRetrospective(body)) {
      printWarn(
        "Retrospective output did not start with a '## Build:' heading; learnings.md not updated.",
      )
      return
    }

    const prefix = fs.existsSync(learningsPath) ? "\n\n" : "# Build Learnings\n\n"
    fs.appendFileSync(learningsPath, prefix + body + "\n")

    printInfo(`Retrospective complete. Learnings appended to ${path.relative(process.cwd(), learningsPath)}`)
  } catch (err) {
    printError(`Retrospective failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    flush()
  }
}
