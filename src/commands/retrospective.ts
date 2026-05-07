import * as fs from "node:fs"
import * as path from "node:path"
import { run } from "fascicle"
import { printInfo, printError, printWarn } from "../ui/output.js"
import { runClaudeOneShot } from "../engine/claude.runner.js"
import { createStreamDisplay } from "../ui/claude-stream-display.js"
import { buildAgentRegistry } from "../engine/discovery/agent.registry.js"
import { loadBudget } from "../stores/budget.js"
import { readTrajectory } from "../stores/trajectory.js"
import { loadState } from "../stores/state.js"
import { resolveSandboxMode } from "../stores/settings.js"
import { makeRidgelineEngine } from "../engine/engine.factory.js"
import { retrospectiveFlow, type RetrospectiveFlowInput } from "../engine/flows/retrospective.flow.js"

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

  printInfo(`Running retrospective for build '${buildName}'...`)

  const engine = makeRidgelineEngine({
    sandboxFlag: resolveSandboxMode(ridgelineDir, undefined),
    timeoutMinutes: opts.timeout,
    pluginDirs: [],
    settingSources: ["user", "project", "local"],
    buildPath: buildDir,
  })

  const flow = retrospectiveFlow({
    executor: async (input: RetrospectiveFlowInput) => {
      const { onChunk, flush } = createStreamDisplay({ projectRoot: process.cwd() })
      try {
        return await runClaudeOneShot({
          engine,
          model: input.model,
          system: input.systemPrompt,
          prompt: input.userPrompt,
          allowedTools: ["Read", "Glob", "Grep", "Skill"],
          onChunk,
        })
      } finally {
        flush()
      }
    },
  })

  let result
  try {
    try {
      const out = await run(flow, {
        systemPrompt,
        userPrompt,
        model: opts.model,
        timeoutMs: opts.timeout * 60 * 1000,
      }, { install_signal_handlers: false })
      result = out.result
    } finally {
      await engine.dispose()
    }
  } catch (err) {
    printError(`Retrospective failed: ${err instanceof Error ? err.message : String(err)}`)
    return
  }

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
}
