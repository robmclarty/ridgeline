import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import { printInfo, printWarn } from "../ui/output"
import { buildAgentRegistry } from "../engine/discovery/agent.registry"
import { runOneShotCall } from "./qa-workflow"
import { getMatchedShapes } from "../stores/state"

export type DirectionsOptions = {
  model: string
  timeout: number
  isThorough?: boolean
  isSkip?: boolean
}

const VISUAL_SHAPES: ReadonlySet<string> = new Set(["web-visual", "game-visual", "print-layout"])

const isVisualShape = (matched: string[]): boolean =>
  matched.some((name) => VISUAL_SHAPES.has(name))

const resolveDirectionsDir = (buildDir: string | null, ridgelineDir: string): string =>
  buildDir ? path.join(buildDir, "directions") : path.join(ridgelineDir, "directions")

const collectDirectionsContext = (
  buildDir: string | null,
  ridgelineDir: string,
  matchedShapes: string[],
): string[] => {
  const parts: string[] = []

  const shapePath = buildDir ? path.join(buildDir, "shape.md") : null
  if (shapePath && fs.existsSync(shapePath)) {
    parts.push("## shape.md\n")
    parts.push(fs.readFileSync(shapePath, "utf-8"))
    parts.push("")
  }

  const projectDesign = path.join(ridgelineDir, "design.md")
  const featureDesign = buildDir ? path.join(buildDir, "design.md") : null
  for (const candidate of [featureDesign, projectDesign].filter(Boolean) as string[]) {
    if (fs.existsSync(candidate)) {
      parts.push("## Existing design.md (treat as starting constraint, not hard lock)\n")
      parts.push(fs.readFileSync(candidate, "utf-8"))
      parts.push("")
      break
    }
  }

  const tastePath = buildDir ? path.join(buildDir, "taste.md") : null
  if (tastePath && fs.existsSync(tastePath)) {
    parts.push("## taste.md\n")
    parts.push(fs.readFileSync(tastePath, "utf-8"))
    parts.push("")
  }

  const anchorsPath = buildDir ? path.join(buildDir, "references", "visual-anchors.md") : null
  if (anchorsPath && fs.existsSync(anchorsPath)) {
    parts.push("## Reference Anchors (`<buildDir>/references/visual-anchors.md`)\n")
    parts.push(fs.readFileSync(anchorsPath, "utf-8"))
    parts.push("")
  }

  if (matchedShapes.length > 0) {
    parts.push("## Matched Shape Categories\n")
    parts.push(matchedShapes.join(", "))
    parts.push("")
  }

  return parts
}

const listDirectionFolders = (outputDir: string): string[] => {
  if (!fs.existsSync(outputDir)) return []
  return fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{2}-/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
}

const promptForPick = async (
  rl: readline.Interface,
  outputDir: string,
  directions: string[],
): Promise<string | null> => {
  console.log("")
  printInfo("Direction options written to:")
  for (const dir of directions) {
    console.log(`  ${path.join(outputDir, dir, "demo", "index.html")}`)
  }
  console.log("")
  console.log("Open each demo in a browser, then enter the id you want to pick (e.g., 01-worn-foundry)")
  console.log("Or enter 'none' to regenerate (you'll be prompted for notes).")
  console.log("")

  return new Promise((resolve) => {
    rl.question("Pick: ", (answer: string) => resolve(answer.trim()))
  })
}

const writePickedMarker = (outputDir: string, pickedId: string): void => {
  fs.writeFileSync(path.join(outputDir, "picked.txt"), pickedId + "\n")
}

export const runDirections = async (
  buildName: string,
  opts: DirectionsOptions,
): Promise<void> => {
  if (opts.isSkip) {
    printInfo("Skipping direction-advisor (--skip).")
    return
  }

  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = path.join(ridgelineDir, "builds", buildName)

  if (!fs.existsSync(buildDir)) {
    throw new Error(`Build directory not found: ${buildDir}. Run 'ridgeline shape ${buildName}' first.`)
  }

  const matchedShapes = getMatchedShapes(buildDir)
  if (!isVisualShape(matchedShapes)) {
    printInfo(
      `No visual shape categories matched (got: ${matchedShapes.join(", ") || "none"}). ` +
        `direction-advisor exits without generating directions.`,
    )
    return
  }

  const matchedVisual = matchedShapes.filter((name) => VISUAL_SHAPES.has(name))
  if (!matchedVisual.includes("web-visual")) {
    printWarn(
      `direction-advisor currently supports web-visual only; matched shapes (${matchedVisual.join(", ")}) ` +
        `not yet supported. Skipping.`,
    )
    return
  }

  const numDirections = opts.isThorough ? 3 : 2
  const outputDir = resolveDirectionsDir(buildDir, ridgelineDir)
  fs.mkdirSync(outputDir, { recursive: true })

  printInfo(`Build directory: ${buildDir}`)
  printInfo(`Generating ${numDirections} differentiated direction(s) under: ${outputDir}`)
  printInfo(`Expected cost: ~$2-5 with opus (one-shot generation of ${numDirections} HTML demos).`)

  const registry = buildAgentRegistry()
  const systemPrompt = registry.getCorePrompt("direction-advisor.md")
  const contextParts = collectDirectionsContext(buildDir, ridgelineDir, matchedShapes)

  const userPrompt = [
    `Generate ${numDirections} differentiated visual direction(s) for build "${buildName}".`,
    "",
    `Output directory (use absolute paths when writing): ${outputDir}`,
    "",
    ...(contextParts.length > 0 ? contextParts : ["No additional context found."]),
    "",
    `Produce ${numDirections} direction subdirectories under the output directory, each named ` +
      `\`<NN>-<slug>/\` (e.g., \`01-worn-foundry/\`, \`02-brutalist-schematic/\`). Each must contain ` +
      `\`brief.md\`, \`tokens.md\`, and \`demo/index.html\` per the spec in your system prompt.`,
    "",
    "Each direction must come from a different visual school with a named reference work. Three " +
      "variations on one theme = one direction. If you cannot name two distinct schools that fit, " +
      "reduce to one direction and explain why in stderr.",
  ].join("\n")

  const timeoutMs = opts.timeout * 60 * 1000

  await runOneShotCall({
    systemPrompt,
    userPrompt,
    model: opts.model,
    timeoutMs,
    allowedTools: ["Read", "Glob", "Grep", "Write"],
    buildDir,
    statusMessage: `Generating ${numDirections} direction(s)...`,
  })

  const directions = listDirectionFolders(outputDir)
  if (directions.length === 0) {
    throw new Error(
      `direction-advisor wrote no direction folders under ${outputDir}. ` +
        `Inspect the output above for errors.`,
    )
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const pick = await promptForPick(rl, outputDir, directions)
    if (!pick || pick.toLowerCase() === "none") {
      console.log("")
      printInfo("No direction picked. Re-run with adjusted shape.md or taste.md to regenerate.")
      return
    }
    if (!directions.includes(pick)) {
      throw new Error(
        `Pick "${pick}" does not match any generated direction. Available: ${directions.join(", ")}`,
      )
    }
    writePickedMarker(outputDir, pick)
    console.log("")
    printInfo(`Picked: ${pick}`)
    printInfo(`Next: ridgeline design ${buildName}`)
  } finally {
    rl.close()
  }
}
