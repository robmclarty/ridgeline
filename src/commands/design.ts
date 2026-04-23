import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import { printInfo } from "../ui/output"
import { buildAgentRegistry } from "../engine/discovery/agent.registry"
import { advancePipeline } from "../stores/state"
import { runQAIntake, runOutputTurn } from "./qa-workflow"
import { resolveAssetDirSafe } from "../catalog/resolve-asset-dir"
import { AssetCatalog } from "../catalog/types"
import { countByField } from "./catalog"

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

  const registry = buildAgentRegistry()
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

    // Inject asset catalog context if available
    const catalogContext = await loadCatalogContext(buildName, buildDir, ridgelineDir, opts)
    if (catalogContext) {
      contextParts.push(catalogContext)
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
