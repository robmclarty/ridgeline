import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import { printInfo } from "../ui/output"
import { buildAgentRegistry } from "../engine/discovery/agent.registry"
import { resolveFlavour } from "../engine/discovery/flavour.resolve"
import { advancePipeline } from "../stores/state"
import { runQAIntake, runOutputTurn } from "./qa-workflow"

/** Determine where to write design.md. */
const resolveDesignOutputPath = (
  buildDir: string | null,
  ridgelineDir: string,
): string => {
  if (buildDir) return path.join(buildDir, "design.md")
  return path.join(ridgelineDir, "design.md")
}

type DesignOptions = {
  model: string
  timeout: number
  flavour?: string
  matchedShapes?: string[]
}

export const runDesign = async (
  buildName: string | null,
  opts: DesignOptions
): Promise<void> => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = buildName
    ? path.join(ridgelineDir, "builds", buildName)
    : null

  const outputPath = resolveDesignOutputPath(buildDir, ridgelineDir)
  const timeoutMs = opts.timeout * 60 * 1000

  printInfo(buildDir ? `Build directory: ${buildDir}` : "Project-level design")

  const registry = buildAgentRegistry(resolveFlavour(opts.flavour ?? null))
  const systemPrompt = registry.getCorePrompt("designer.md")

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  try {
    // Gather existing context
    const contextParts: string[] = []

    const projectDesign = path.join(ridgelineDir, "design.md")
    if (fs.existsSync(projectDesign)) {
      contextParts.push("## Existing Project Design\n")
      contextParts.push(fs.readFileSync(projectDesign, "utf-8"))
      contextParts.push("")
    }

    if (buildDir) {
      const featureDesign = path.join(buildDir, "design.md")
      if (fs.existsSync(featureDesign)) {
        contextParts.push("## Existing Feature Design\n")
        contextParts.push(fs.readFileSync(featureDesign, "utf-8"))
        contextParts.push("")
      }

      const shapePath = path.join(buildDir, "shape.md")
      if (fs.existsSync(shapePath)) {
        contextParts.push("## shape.md\n")
        contextParts.push(fs.readFileSync(shapePath, "utf-8"))
        contextParts.push("")
      }
    }

    if (opts.matchedShapes && opts.matchedShapes.length > 0) {
      contextParts.push("## Matched Shape Categories\n")
      contextParts.push(opts.matchedShapes.join(", "))
      contextParts.push("")
    }

    const userPrompt = [
      buildName
        ? `Gather design system context for build "${buildName}".`
        : "Gather project-level design system context.",
      "",
      ...(contextParts.length > 0 ? contextParts : ["No existing design context found."]),
      "",
      "Analyze the context above and ask design-focused questions.",
      "Remember: present ALL questions to the user even when pre-filled.",
    ].join("\n")

    // Intake + clarification loop
    const { sessionId, qa } = await runQAIntake(
      rl, systemPrompt, userPrompt,
      { model: opts.model, questionLabel: "Design questions" },
      timeoutMs, "Analyzing design context...",
    )

    // Design output turn — no JSON schema, freeform markdown
    if (qa.summary) {
      console.log(`\nDesign summary:\n  ${qa.summary}`)
    }

    const designResult = await runOutputTurn(
      systemPrompt,
      "Produce the final design document now. Respond with freeform markdown — NOT JSON. Structure it with headings, specific values (hard tokens), and directional guidance (soft guidance).",
      opts.model, timeoutMs, sessionId, "Producing design document...",
    )

    // Write design.md
    const designDir = path.dirname(outputPath)
    if (!fs.existsSync(designDir)) {
      fs.mkdirSync(designDir, { recursive: true })
    }
    fs.writeFileSync(outputPath, designResult.result)

    // Update pipeline state if in build context
    if (buildName && buildDir) {
      advancePipeline(buildDir, buildName, "design")
    }

    console.log("")
    printInfo("Created:")
    console.log(`  ${outputPath}`)
    console.log("")
    if (buildName) {
      printInfo(`Next: ridgeline spec ${buildName}`)
    }
  } finally {
    rl.close()
  }
}
