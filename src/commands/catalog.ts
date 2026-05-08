import * as fs from "node:fs"
import * as path from "node:path"
import { CatalogOptions } from "../catalog/types.js"
import { resolveAssetDir } from "../catalog/resolve-asset-dir.js"
import { buildCatalog, CatalogResult } from "../catalog/build-catalog.js"
import { describeAssets } from "../catalog/vision-describe.js"
import { packAtlases } from "../catalog/pack-sprites.js"
import { printInfo } from "../ui/output.js"

/** Count items by a string field and format as an indented list. */
export const countByField = (
  items: { [k: string]: unknown }[],
  field: string,
  indent = "    ",
): string => {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = String(item[field])
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => `${indent}${key}: ${n}`)
    .join("\n")
}

/** Summarize asset counts by category. */
const summarizeByCategory = (result: CatalogResult): string =>
  countByField(result.catalog.assets, "category")

/** Summarize asset counts by media type. */
const summarizeByMediaType = (result: CatalogResult): string =>
  countByField(result.catalog.assets, "mediaType")

export const runCatalog = async (buildName: string, opts: CatalogOptions): Promise<void> => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = path.join(ridgelineDir, "builds", buildName)

  // Ensure build directory exists
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true })
  }

  // 1. Resolve asset directory
  const assetDir = resolveAssetDir(buildName, opts.assetDir)
  printInfo(`Asset directory: ${assetDir}`)

  // 2. Build catalog (Tier 1 — deterministic + optional classification)
  printInfo("Scanning assets...")
  const result = await buildCatalog(assetDir, buildDir, {
    isForce: opts.isForce,
    isClassify: opts.isClassify,
    model: opts.model,
    timeout: opts.timeout,
  })

  // 3. Vision enrichment (Tier 2) — for --describe or auto-describe categories
  const needsVision = opts.isDescribe
    ? result.catalog.assets.filter((a) => a.mediaType === "image" && !a.description).map((a) => a.file)
    : result.needsVisionDescribe

  if (needsVision.length > 0) {
    printInfo(`Describing ${needsVision.length} asset(s) with vision...`)
    await describeAssets(result.catalog, assetDir, needsVision, {
      model: opts.model,
      isBatch: opts.isBatch,
      timeoutMs: opts.timeout * 60 * 1000,
    })
    result.catalog.isDescribed = true
  }

  // 4. Sprite packing (images only)
  if (opts.isPack) {
    printInfo("Packing sprite atlases...")
    await packAtlases(assetDir, result.catalog)
  }

  // 5. Write catalog
  const catalogPath = path.join(buildDir, "asset-catalog.json")
  fs.writeFileSync(catalogPath, JSON.stringify(result.catalog, null, 2) + "\n")

  // 6. Print summary
  const { stats } = result
  console.log("")
  printInfo("Asset catalog complete:")
  console.log(`  ${stats.total} assets total`)
  if (stats.added > 0) console.log(`  + ${stats.added} new`)
  if (stats.updated > 0) console.log(`  ~ ${stats.updated} updated`)
  if (stats.unchanged > 0) console.log(`  = ${stats.unchanged} unchanged`)
  if (stats.pruned > 0) console.log(`  - ${stats.pruned} pruned`)
  if (stats.classified > 0) console.log(`  * ${stats.classified} classified by AI`)
  console.log("")

  if (result.catalog.assets.length > 0) {
    console.log("  By category:")
    console.log(summarizeByCategory(result))
    console.log("")
    console.log("  By media type:")
    console.log(summarizeByMediaType(result))
    console.log("")
  }

  if (result.catalog.visualIdentity.detectedStyle) {
    printInfo(`Detected style: ${result.catalog.visualIdentity.detectedStyle}`)
  }
  if (result.catalog.visualIdentity.detectedResolution) {
    printInfo(`Detected resolution: ${result.catalog.visualIdentity.detectedResolution}`)
  }

  if (result.catalog.warnings.length > 0) {
    console.log("")
    printInfo("Warnings:")
    for (const w of result.catalog.warnings) {
      console.log(`  ⚠ ${w}`)
    }
  }

  console.log("")
  printInfo(`Written: ${catalogPath}`)
}
