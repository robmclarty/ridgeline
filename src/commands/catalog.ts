import * as fs from "node:fs"
import * as path from "node:path"
import { CatalogOptions } from "../catalog/types"
import { resolveAssetDir } from "../catalog/resolve-asset-dir"
import { buildCatalog, CatalogResult } from "../catalog/build-catalog"
import { describeAssets } from "../catalog/vision-describe"
import { packAtlases } from "../catalog/pack-sprites"
import { printInfo } from "../ui/output"

/** Summarize asset counts by category. */
const summarizeByCategory = (result: CatalogResult): string => {
  const counts = new Map<string, number>()
  for (const a of result.catalog.assets) {
    counts.set(a.category, (counts.get(a.category) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `    ${cat}: ${n}`)
    .join("\n")
}

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

  // 2. Build catalog (Tier 1 — deterministic)
  printInfo("Scanning assets...")
  const result = await buildCatalog(assetDir, buildDir, { isForce: opts.isForce })

  // 3. Vision enrichment (Tier 2) — for --describe or auto-describe categories
  const needsVision = opts.isDescribe
    ? result.catalog.assets.filter((a) => !a.description).map((a) => a.file)
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

  // 4. Sprite packing
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
  console.log("")

  if (result.catalog.assets.length > 0) {
    console.log("  By category:")
    console.log(summarizeByCategory(result))
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
