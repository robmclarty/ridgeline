import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import { printInfo, printWarn } from "../ui/output.js"
import { buildAgentRegistry } from "../engine/discovery/agent.registry.js"
import { runOneShotCall } from "./qa-workflow.js"
import { getMatchedShapes } from "../stores/state.js"
import { resolveInputBundle, ResolvedBundle } from "./input.js"

type DirectionsOptions = {
  model: string
  timeout: number
  count?: number
  isSkip?: boolean
}

type DirectionsAutoOptions = DirectionsOptions & {
  /** Source of inspiration for the picker. Path or inline text. */
  inspiration?: string
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

type DirectionsPrelude =
  | { ok: true; ridgelineDir: string; buildDir: string; outputDir: string; matchedShapes: string[] }
  | { ok: false }

/**
 * Shared prelude for runDirections / runDirectionsAuto: ensure the build dir
 * exists, verify a visual shape matched, ensure web-visual support. On any
 * gate failure prints an info/warn line and returns { ok: false } so the
 * caller exits early without throwing.
 */
const setupDirectionsRun = (buildName: string): DirectionsPrelude => {
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
    return { ok: false }
  }

  const matchedVisual = matchedShapes.filter((name) => VISUAL_SHAPES.has(name))
  if (!matchedVisual.includes("web-visual")) {
    printWarn(
      `direction-advisor currently supports web-visual only; matched shapes (${matchedVisual.join(", ")}) ` +
        `not yet supported. Skipping.`,
    )
    return { ok: false }
  }

  const outputDir = resolveDirectionsDir(buildDir, ridgelineDir)
  fs.mkdirSync(outputDir, { recursive: true })
  return { ok: true, ridgelineDir, buildDir, outputDir, matchedShapes }
}

export const runDirections = async (
  buildName: string,
  opts: DirectionsOptions,
): Promise<void> => {
  if (opts.isSkip) {
    printInfo("Skipping direction-advisor (--skip).")
    return
  }

  const setup = setupDirectionsRun(buildName)
  if (!setup.ok) return
  const { ridgelineDir, buildDir, outputDir, matchedShapes } = setup

  const numDirections = opts.count ?? 2

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

// ---------------------------------------------------------------------------
// Auto mode: parallel design-specialists + picker
// ---------------------------------------------------------------------------

/**
 * School hints rotated through the N parallel specialists. Each specialist
 * gets a distinct hint so the picker has genuinely differentiated options.
 * If N exceeds the list length, hints repeat — and downstream specialists
 * are told to find a fresh angle within the same broad school.
 */
const DESIGN_SCHOOLS: string[] = [
  "tactile / lived-in / FFT-warm — parchment, sepia, ochre; named references like Final Fantasy Tactics, EXAPUNKS, Edward Tufte information density",
  "brutalist schematic / blueprint / control-room — drafted precision, heavy grid, mono type; references like Dieter Rams, NASA control panels, Swiss railway signage",
  "gem-cut precision / heavy material / deep depth — saturated jewel tones, sharp bevels, glass-and-stone tactility",
  "minimalist editorial / quiet luxury — type-led, generous whitespace, muted neutrals; references like Linear, Things 3, iA Writer",
  "post-internet / crispy maximalist — saturated palette, layered gradients, expressive type; references like Figma marketing, Notion glyphs, contemporary indie zines",
  "industrial / lab / specimen — neutral background, calibrated samples, dense annotation; references like physics lab UIs, MIT Press, Wolfram Alpha",
]

const slugForSchool = (index: number, school: string): string => {
  const head = school.split(" ")[0].toLowerCase().replace(/\W+/g, "")
  return `${String(index + 1).padStart(2, "0")}-${head}`
}

const buildSpecialistPrompt = (
  buildName: string,
  outputDir: string,
  contextParts: string[],
  inspirationContent: string | null,
  index: number,
  count: number,
  school: string,
  slug: string,
): string => {
  const lines = [
    `Generate ONE visual direction for build "${buildName}".`,
    "",
    `Specialist ${index + 1} of ${count}.`,
    `Assigned visual school: ${school}`,
    "",
    `Output directory (write all files here, use absolute paths):`,
    `${path.join(outputDir, slug)}`,
    "",
    "Files to write:",
    `- ${path.join(outputDir, slug, "brief.md")}`,
    `- ${path.join(outputDir, slug, "tokens.md")}`,
    `- ${path.join(outputDir, slug, "demo", "index.html")}`,
    "",
    ...(contextParts.length > 0 ? contextParts : ["No additional context found."]),
  ]
  if (inspirationContent) {
    lines.push("", "## Inspiration (from --inspiration flag)\n", inspirationContent, "")
  }
  lines.push(
    "",
    "Produce exactly one direction in your assigned school. Do not generate alternatives. " +
      "Honor the school hint even if you think a different school would fit better — diversity " +
      "across specialists is the point, and the picker will weigh fit at the end.",
  )
  return lines.join("\n")
}

const buildPickerPrompt = (
  buildName: string,
  outputDir: string,
  directionIds: string[],
  inspirationContent: string | null,
): string => {
  const lines: string[] = [
    `Pick the best visual direction for build "${buildName}".`,
    "",
    `${directionIds.length} candidate directions are available under: ${outputDir}`,
    "",
    "Candidate IDs:",
    ...directionIds.map((id) => `- ${id}`),
    "",
    "For each candidate, read its brief.md and tokens.md (and skim demo/index.html if it helps). " +
      "Then evaluate against the inspiration material below.",
  ]
  if (inspirationContent) {
    lines.push("", "## Inspiration\n", inspirationContent, "")
  } else {
    lines.push(
      "",
      "## Inspiration",
      "",
      "(none provided — output PICKED: ambiguous so the orchestrator can prompt the user)",
      "",
    )
  }
  lines.push(
    "",
    "Output exactly one line, nothing else:",
    "",
    "PICKED: <id>",
    "",
    "…where <id> is one of the candidate IDs above, or the literal word `ambiguous` if no clear winner.",
  )
  return lines.join("\n")
}

const parsePickerOutput = (text: string, validIds: string[]): string | "ambiguous" | null => {
  const match = text.match(/PICKED:\s*(\S+)/)
  if (!match) return null
  const value = match[1].trim()
  if (value === "ambiguous") return "ambiguous"
  if (validIds.includes(value)) return value
  return null
}

const loadInspiration = (inspiration: string | undefined): { content: string | null; label: string | null } => {
  if (!inspiration) return { content: null, label: null }
  try {
    const bundle: ResolvedBundle = resolveInputBundle(inspiration)
    if (bundle.type === "file") return { content: bundle.content, label: bundle.path }
    if (bundle.type === "directory") return { content: bundle.content, label: `${bundle.path} (${bundle.files.length} files)` }
    return { content: bundle.content, label: "inline text" }
  } catch (err) {
    printWarn(`Failed to read --inspiration: ${err instanceof Error ? err.message : String(err)}`)
    return { content: null, label: null }
  }
}

export const runDirectionsAuto = async (
  buildName: string,
  opts: DirectionsAutoOptions,
): Promise<void> => {
  const setup = setupDirectionsRun(buildName)
  if (!setup.ok) return
  const { buildDir, outputDir, matchedShapes } = setup
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")

  const numDirections = Math.max(2, opts.count ?? 3)

  const inspiration = loadInspiration(opts.inspiration)
  printInfo(`Build directory: ${buildDir}`)
  printInfo(`Generating ${numDirections} direction(s) in parallel under: ${outputDir}`)
  if (inspiration.label) {
    printInfo(`Inspiration: ${inspiration.label}`)
  } else {
    printInfo("Inspiration: (none — picker will fall back to interactive prompt if needed)")
  }
  printInfo(`Expected cost: ~$${(numDirections * 1.5).toFixed(0)}-$${(numDirections * 2.5).toFixed(0)} with opus.`)

  const registry = buildAgentRegistry()
  const specialist = registry.getSpecialist("specialists", "design-specialist.md")
  if (!specialist) {
    throw new Error("design-specialist agent not found in registry")
  }
  const advisorPrompt = registry.getCorePrompt("direction-advisor.md")
  const contextParts = collectDirectionsContext(buildDir, ridgelineDir, matchedShapes)
  const timeoutMs = opts.timeout * 60 * 1000

  const assignments = Array.from({ length: numDirections }, (_, i) => {
    const school = DESIGN_SCHOOLS[i % DESIGN_SCHOOLS.length]
    return { index: i, school, slug: slugForSchool(i, school) }
  })

  // Dispatch specialists in parallel.
  await Promise.all(
    assignments.map((a) =>
      runOneShotCall({
        systemPrompt: specialist.overlay,
        userPrompt: buildSpecialistPrompt(
          buildName, outputDir, contextParts, inspiration.content,
          a.index, numDirections, a.school, a.slug,
        ),
        model: opts.model,
        timeoutMs,
        allowedTools: ["Read", "Glob", "Grep", "Write"],
        buildDir,
        statusMessage: `Specialist ${a.index + 1}/${numDirections} (${a.slug}) generating direction...`,
      }),
    ),
  )

  const directions = listDirectionFolders(outputDir)
  if (directions.length === 0) {
    throw new Error(
      `No specialist produced direction folders under ${outputDir}. Inspect the output above for errors.`,
    )
  }

  let pick: string | null = null

  if (inspiration.content) {
    const pickerResult = await runOneShotCall({
      systemPrompt: advisorPrompt,
      userPrompt: buildPickerPrompt(buildName, outputDir, directions, inspiration.content),
      model: opts.model,
      timeoutMs,
      allowedTools: ["Read", "Glob"],
      buildDir,
      statusMessage: "Picking best direction against inspiration...",
    })
    const picked = parsePickerOutput(pickerResult.result, directions)
    if (picked === "ambiguous" || picked === null) {
      printInfo("Picker returned ambiguous (or invalid) result; falling back to interactive prompt.")
    } else {
      pick = picked
    }
  } else {
    printInfo("No inspiration provided; skipping picker and prompting interactively.")
  }

  if (!pick) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      const answer = await promptForPick(rl, outputDir, directions)
      if (!answer || answer.toLowerCase() === "none") {
        console.log("")
        printInfo("No direction picked. Re-run with adjusted inspiration or shape.md to regenerate.")
        return
      }
      if (!directions.includes(answer)) {
        throw new Error(
          `Pick "${answer}" does not match any generated direction. Available: ${directions.join(", ")}`,
        )
      }
      pick = answer
    } finally {
      rl.close()
    }
  }

  writePickedMarker(outputDir, pick)
  console.log("")
  printInfo(`Picked: ${pick}`)
  printInfo(`Next: ridgeline design ${buildName}`)
}
