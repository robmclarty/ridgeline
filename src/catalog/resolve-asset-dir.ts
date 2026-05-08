import * as fs from "node:fs"
import * as path from "node:path"
import { loadSettings } from "../stores/settings.js"

/**
 * Resolve the asset directory in priority order:
 * 1. Explicit --asset-dir flag
 * 2. .ridgeline/builds/<name>/assets/
 * 3. .ridgeline/assets/
 * 4. settings.json assetDir
 *
 * Throws if no directory is found.
 */
export const resolveAssetDir = (buildName: string | null, explicitDir?: string): string => {
  const cwd = process.cwd()
  const ridgelineDir = path.join(cwd, ".ridgeline")
  const checked: string[] = []

  // 1. Explicit --asset-dir
  if (explicitDir) {
    const resolved = path.resolve(cwd, explicitDir)
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved
    throw new Error(`Asset directory not found: ${resolved}`)
  }

  // 2. Build-scoped assets
  if (buildName) {
    const buildAssets = path.join(ridgelineDir, "builds", buildName, "assets")
    checked.push(buildAssets)
    if (fs.existsSync(buildAssets) && fs.statSync(buildAssets).isDirectory()) return buildAssets
  }

  // 3. Project-scoped assets
  const projectAssets = path.join(ridgelineDir, "assets")
  checked.push(projectAssets)
  if (fs.existsSync(projectAssets) && fs.statSync(projectAssets).isDirectory()) return projectAssets

  // 4. settings.json assetDir
  const settings = loadSettings(ridgelineDir)
  if (settings.assetDir) {
    const settingsDir = path.resolve(cwd, settings.assetDir)
    checked.push(settingsDir)
    if (fs.existsSync(settingsDir) && fs.statSync(settingsDir).isDirectory()) return settingsDir
  }

  throw new Error(
    `No asset directory found. Checked:\n${checked.map((p) => `  - ${p}`).join("\n")}\n\nUse --asset-dir to specify the path explicitly.`
  )
}

/**
 * Safe version that returns null instead of throwing.
 * Used by design phase to check if assets exist before auto-cataloging.
 */
export const resolveAssetDirSafe = (buildName: string | null, explicitDir?: string): string | null => {
  try {
    return resolveAssetDir(buildName, explicitDir)
  } catch {
    return null
  }
}
