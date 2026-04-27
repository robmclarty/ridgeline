import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import { printInfo } from "../ui/output"
import { buildAgentRegistry } from "../engine/discovery/agent.registry"
import { advancePipeline } from "../stores/state"
import { runQAIntake, runOutputTurn, runOneShotCall } from "./qa-workflow"
import { resolveAssetDirSafe } from "../catalog/resolve-asset-dir"
import { AssetCatalog } from "../catalog/types"
import { countByField } from "./catalog"

/**
 * Reusable directive that asks the agent to append a non-rendering
 * `## Inferred / Gaps` section to the output file. Used by ingest when the
 * caller wants visibility into what the agent guessed vs. sourced from input.
 */
const GAP_FLAGGING_DIRECTIVE = [
  "## Gap Flagging",
  "",
  "Append a final section titled `## Inferred / Gaps` to the document. Under that heading, list every load-bearing fact in the document that you inferred without the source input directly stating it. Use one bullet per item:",
  "",
  "- <fact> — inferred because: <one-line reason>",
  "",
  "If every load-bearing fact is source-backed, write `(none)` under the heading. The user will edit this section to confirm or override your guesses before downstream stages run.",
].join("\n")

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
  matchedShapes?: string[]
}

type DesignOneShotOptions = DesignOptions & {
  /** When true, append a `## Inferred / Gaps` section to design.md. */
  inferGapFlagging?: boolean
}

/** Summarize catalog for designer context. Returns null if no catalog exists. */
const loadCatalogContext = async (
  buildName: string | null,
  buildDir: string | null,
  ridgelineDir: string,
  opts: DesignOptions,
): Promise<string | null> => {
  // Check for existing catalog
  const catalogPaths = [
    buildDir ? path.join(buildDir, "asset-catalog.json") : null,
    path.join(ridgelineDir, "asset-catalog.json"),
  ].filter(Boolean) as string[]

  let catalogPath = catalogPaths.find((p) => fs.existsSync(p)) ?? null

  // Auto-run catalog if assets exist but no catalog found
  if (!catalogPath && buildName) {
    const assetDir = resolveAssetDirSafe(buildName, undefined)
    if (assetDir) {
      printInfo("Assets found but no catalog exists. Running catalog...")
      const { runCatalog } = await import("./catalog")
      await runCatalog(buildName, {
        model: opts.model,
        timeout: opts.timeout,
        isDescribe: false,
        isForce: false,
        isPack: false,
        isBatch: false,
        isClassify: false,
      })
      // Re-check for catalog
      catalogPath = catalogPaths.find((p) => fs.existsSync(p)) ?? null
    }
  }

  if (!catalogPath) return null

  try {
    const catalog: AssetCatalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"))
    return summarizeCatalog(catalog)
  } catch {
    return null
  }
}

/** Build a concise text summary of the catalog for the designer agent. */
const summarizeCatalog = (catalog: AssetCatalog): string => {
  const lines: string[] = ["## Asset Catalog Summary\n"]

  lines.push(`${catalog.assets.length} assets cataloged.`)

  // Counts by category
  const catList = countByField(catalog.assets, "category", "  ")
  if (catList) lines.push(`\nBy category:\n${catList}`)

  // Visual identity
  const vi = catalog.visualIdentity
  if (vi.detectedStyle) lines.push(`\nDetected style: ${vi.detectedStyle}`)
  if (vi.detectedResolution) lines.push(`Detected resolution: ${vi.detectedResolution}`)
  if (vi.detectedPalette.length > 0) {
    lines.push(`Detected palette: ${vi.detectedPalette.join(", ")}`)
  }
  if (vi.detectedScaling) lines.push(`Suggested scaling: ${vi.detectedScaling}`)

  // Warnings
  if (catalog.warnings.length > 0) {
    lines.push("\nWarnings:")
    for (const w of catalog.warnings) {
      lines.push(`  - ${w}`)
    }
  }

  return lines.join("\n")
}

/** Load the picked direction's brief.md and tokens.md if a pick exists. */
const loadPickedDirectionContext = (buildDir: string | null): string | null => {
  if (!buildDir) return null
  const directionsDir = path.join(buildDir, "directions")
  const pickedFile = path.join(directionsDir, "picked.txt")
  if (!fs.existsSync(pickedFile)) return null

  let pickedId: string
  try {
    pickedId = fs.readFileSync(pickedFile, "utf-8").trim()
  } catch {
    return null
  }
  if (!pickedId) return null

  const directionDir = path.join(directionsDir, pickedId)
  if (!fs.existsSync(directionDir)) {
    printInfo(`Picked direction "${pickedId}" no longer exists on disk; ignoring.`)
    return null
  }

  const sections: string[] = [`## Picked Direction: ${pickedId}\n`]
  const briefPath = path.join(directionDir, "brief.md")
  if (fs.existsSync(briefPath)) {
    sections.push("### Brief\n")
    sections.push(fs.readFileSync(briefPath, "utf-8"))
    sections.push("")
  }
  const tokensPath = path.join(directionDir, "tokens.md")
  if (fs.existsSync(tokensPath)) {
    sections.push("### Tokens (use as design.md seed)\n")
    sections.push(fs.readFileSync(tokensPath, "utf-8"))
    sections.push("")
  }
  return sections.join("\n")
}

/** Collect design context (existing design.md, shape.md, matched shapes, asset catalog, picked direction). */
const gatherDesignContext = async (
  buildName: string | null,
  buildDir: string | null,
  ridgelineDir: string,
  opts: DesignOptions,
): Promise<string[]> => {
  const contextParts: string[] = []

  const pickedDirection = loadPickedDirectionContext(buildDir)
  if (pickedDirection) {
    contextParts.push(pickedDirection)
    contextParts.push("")
  }

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

  const catalogContext = await loadCatalogContext(buildName, buildDir, ridgelineDir, opts)
  if (catalogContext) {
    contextParts.push(catalogContext)
    contextParts.push("")
  }

  return contextParts
}

const writeDesignOutput = (
  buildName: string | null,
  buildDir: string | null,
  outputPath: string,
  rawOutput: string,
): void => {
  const designDir = path.dirname(outputPath)
  if (!fs.existsSync(designDir)) {
    fs.mkdirSync(designDir, { recursive: true })
  }
  fs.writeFileSync(outputPath, rawOutput)

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
}

type DesignRunSetup = {
  ridgelineDir: string
  buildDir: string | null
  outputPath: string
  timeoutMs: number
  systemPrompt: string
  contextParts: string[]
}

const setupDesignRun = async (
  buildName: string | null,
  opts: DesignOptions,
): Promise<DesignRunSetup> => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = buildName ? path.join(ridgelineDir, "builds", buildName) : null
  const outputPath = resolveDesignOutputPath(buildDir, ridgelineDir)
  const timeoutMs = opts.timeout * 60 * 1000

  printInfo(buildDir ? `Build directory: ${buildDir}` : "Project-level design")

  const registry = buildAgentRegistry()
  const systemPrompt = registry.getCorePrompt("designer.md")
  const contextParts = await gatherDesignContext(buildName, buildDir, ridgelineDir, opts)
  return { ridgelineDir, buildDir, outputPath, timeoutMs, systemPrompt, contextParts }
}

export const runDesign = async (
  buildName: string | null,
  opts: DesignOptions
): Promise<void> => {
  const { buildDir, outputPath, timeoutMs, systemPrompt, contextParts } =
    await setupDesignRun(buildName, opts)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  try {
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

    const { sessionId, qa } = await runQAIntake(
      rl, systemPrompt, userPrompt,
      { model: opts.model, questionLabel: "Design questions" },
      timeoutMs, "Analyzing design context...",
    )

    if (qa.summary) {
      console.log(`\nDesign summary:\n  ${qa.summary}`)
    }

    const designResult = await runOutputTurn(
      systemPrompt,
      "Produce the final design document now. Respond with freeform markdown — NOT JSON. Structure it with headings, specific values (hard tokens), and directional guidance (soft guidance).",
      opts.model, timeoutMs, sessionId, "Producing design document...",
    )

    writeDesignOutput(buildName, buildDir, outputPath, designResult.result)
  } finally {
    rl.close()
  }
}

/**
 * Non-interactive design: produce design.md from shape.md + catalog context
 * in a single LLM call, no Q&A. Used by `ingest` when visual shapes match.
 */
export const runDesignOneShot = async (
  buildName: string | null,
  opts: DesignOneShotOptions,
): Promise<void> => {
  const { buildDir, outputPath, timeoutMs, systemPrompt, contextParts } =
    await setupDesignRun(buildName, opts)

  const promptSections = [
    buildName
      ? `Produce a design document for build "${buildName}".`
      : "Produce a project-level design document.",
    "",
    ...(contextParts.length > 0 ? contextParts : ["No existing design context found."]),
    "",
    "Synthesize the context above into a design.md document directly. Do NOT ask questions — make reasonable inferences from the source material.",
    "Structure the output as freeform markdown — NOT JSON — with headings, specific values (hard tokens), and directional guidance (soft guidance).",
  ]
  if (opts.inferGapFlagging) {
    promptSections.push("", GAP_FLAGGING_DIRECTIVE)
  }
  const userPrompt = promptSections.join("\n")

  const result = await runOneShotCall({
    systemPrompt,
    userPrompt,
    model: opts.model,
    timeoutMs,
    allowedTools: ["Read", "Glob", "Grep"],
    buildDir: buildDir ?? undefined,
    statusMessage: "Producing design document (non-interactive)...",
  })

  writeDesignOutput(buildName, buildDir, outputPath, result.result)
}
