import * as fs from "node:fs"
import * as path from "node:path"
import { printInfo, printError, printWarn } from "../ui/output"
import { invokeClaude } from "../engine/claude/claude.exec"
import { createDisplayCallbacks } from "../engine/claude/stream.display"
import { buildAgentRegistry } from "../engine/discovery/agent.registry"
import { getInputSource } from "../stores/state"

type RetroRefineOpts = {
  model: string
  timeout: number
}

const REFINED_INPUT_HEADING = "# Refined input (from retrospective)"

const readIfExists = (filepath: string): string | null => {
  if (!fs.existsSync(filepath)) return null
  try {
    return fs.readFileSync(filepath, "utf-8")
  } catch {
    return null
  }
}

const readSourceContent = (sourcePath: string): string | null => {
  if (!fs.existsSync(sourcePath)) return null
  try {
    const stat = fs.statSync(sourcePath)
    if (stat.isFile()) return fs.readFileSync(sourcePath, "utf-8")
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(sourcePath, { withFileTypes: true })
      const pieces: string[] = []
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile()) continue
        const ext = path.extname(entry.name).toLowerCase()
        if (![".md", ".markdown", ".txt", ".rst"].includes(ext)) continue
        const fp = path.join(sourcePath, entry.name)
        pieces.push(`## File: ${entry.name}\n\n${fs.readFileSync(fp, "utf-8").trim()}\n`)
      }
      return pieces.join("\n---\n\n")
    }
  } catch {
    // fall through
  }
  return null
}

const assembleUserPrompt = (buildDir: string, ridgelineDir: string): string | null => {
  const sections: string[] = []

  const learnings = readIfExists(path.join(ridgelineDir, "learnings.md"))
  if (!learnings || learnings.trim().length === 0) {
    return null
  }
  sections.push("## learnings.md\n", learnings, "")

  const inputSource = getInputSource(buildDir)
  if (inputSource) {
    const sourceContent = readSourceContent(inputSource)
    if (sourceContent) {
      sections.push(`## Original input source (${inputSource})\n`, sourceContent, "")
    } else {
      sections.push(
        `## Original input source\n`,
        `(state.json recorded inputSource = ${inputSource} but the file/directory could not be read)`,
        "",
      )
    }
  }

  for (const file of ["spec.md", "constraints.md", "taste.md"]) {
    const content = readIfExists(path.join(buildDir, file))
    if (content) {
      sections.push(`## ${file}\n`, content, "")
    }
  }

  const phasesDir = path.join(buildDir, "phases")
  if (fs.existsSync(phasesDir)) {
    for (const file of fs.readdirSync(phasesDir).filter((f) => f.includes("feedback"))) {
      const content = readIfExists(path.join(phasesDir, file))
      if (content) sections.push(`## ${file}\n`, content, "")
    }
  }

  sections.push(
    "## Instruction",
    "",
    "Produce the refined input document per your system prompt. Begin with the exact heading:",
    "",
    REFINED_INPUT_HEADING,
    "",
    "Output only the refined markdown — no preamble, no closing commentary.",
  )

  return sections.join("\n")
}

const isWellFormedRefinement = (text: string): boolean =>
  text.trimStart().startsWith(REFINED_INPUT_HEADING)

export const runRetroRefine = async (
  buildName: string,
  opts: RetroRefineOpts,
): Promise<void> => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = path.join(ridgelineDir, "builds", buildName)

  if (!fs.existsSync(buildDir)) {
    printError(`Build directory not found: ${buildDir}`)
    return
  }

  const userPrompt = assembleUserPrompt(buildDir, ridgelineDir)
  if (!userPrompt) {
    printWarn(
      `learnings.md is empty or missing under ${ridgelineDir}. ` +
        `Run 'ridgeline retrospective ${buildName}' first to populate it.`,
    )
    return
  }

  const registry = buildAgentRegistry()
  const systemPrompt = registry.getCorePrompt("retro-refiner.md")
  const { onStdout, flush } = createDisplayCallbacks({ projectRoot: process.cwd() })

  printInfo(`Producing refined input for build '${buildName}'...`)

  try {
    const result = await invokeClaude({
      systemPrompt,
      userPrompt,
      model: opts.model,
      allowedTools: ["Read", "Glob", "Grep"],
      cwd: process.cwd(),
      timeoutMs: opts.timeout * 60 * 1000,
      onStdout,
    })

    const body = result.result?.trim() ?? ""
    if (!body) {
      printWarn("retro-refiner produced empty output; refined-input.md not written.")
      return
    }

    if (!isWellFormedRefinement(body)) {
      printWarn(
        `retro-refiner output did not start with '${REFINED_INPUT_HEADING}'; ` +
          `refined-input.md not written.`,
      )
      return
    }

    const outputPath = path.join(buildDir, "refined-input.md")
    fs.writeFileSync(outputPath, body + "\n")
    printInfo(`Refined input written to ${path.relative(process.cwd(), outputPath)}`)
  } catch (err) {
    printError(`retro-refine failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    flush()
  }
}
