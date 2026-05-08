import * as fs from "node:fs"
import * as path from "node:path"

export type ProjectType = "web" | "node" | "unknown"
export type SensorName = "playwright" | "vision" | "a11y" | "contrast"

export interface DetectionReport {
  projectType: ProjectType
  isVisualSurface: boolean
  detectedDeps: string[]
  visualFileExts: string[]
  hasDesignMd: boolean
  hasAssetDir: boolean
  suggestedSensors: SensorName[]
  suggestedEnsembleSize: 1 | 2 | 3
}

export interface DetectOptions {
  specialistCount?: 1 | 2 | 3
}

const VISUAL_DEPS = [
  "react",
  "vue",
  "svelte",
  "solid-js",
  "vite",
  "next",
  "three",
  "phaser",
  "pixi.js",
  "@babylonjs/core",
  "electron",
  "react-native",
  "expo",
] as const

const VISUAL_FILE_EXTS = new Set([".html", ".tsx", ".jsx", ".vue", ".svelte"])
const SCAN_EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  ".worktrees",
  "dist",
  "build",
  ".ridgeline",
  "coverage",
  "fixtures",
])
const ASSET_DIR_NAMES = ["assets", "public", "static"]
const SENSOR_ORDER: SensorName[] = ["playwright", "vision", "a11y", "contrast"]

const readPackageJson = (cwd: string): { deps: string[]; hasFile: boolean; isMalformed: boolean } => {
  const pkgPath = path.join(cwd, "package.json")
  if (!fs.existsSync(pkgPath)) {
    return { deps: [], hasFile: false, isMalformed: false }
  }
  let raw: string
  try {
    raw = fs.readFileSync(pkgPath, "utf-8")
  } catch {
    return { deps: [], hasFile: true, isMalformed: true }
  }
  let parsed: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
  try {
    parsed = JSON.parse(raw)
  } catch {
    process.stderr.write(`[ridgeline] WARN: malformed package.json at ${pkgPath}; falling back to filesystem signals\n`)
    return { deps: [], hasFile: true, isMalformed: true }
  }
  const deps = [
    ...Object.keys(parsed.dependencies ?? {}),
    ...Object.keys(parsed.devDependencies ?? {}),
  ]
  return { deps, hasFile: true, isMalformed: false }
}

const findVisualFileExts = (cwd: string): string[] => {
  const found = new Set<string>()
  const stack: string[] = [cwd]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SCAN_EXCLUDE_DIRS.has(entry.name)) continue
        if (entry.name.startsWith(".") && entry.name !== ".") continue
        stack.push(path.join(dir, entry.name))
        continue
      }
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (VISUAL_FILE_EXTS.has(ext)) {
          found.add(ext.slice(1))
          if (found.size === VISUAL_FILE_EXTS.size) return [...found].sort()
        }
      }
    }
  }
  return [...found].sort()
}

const detectAssetDir = (cwd: string): boolean => {
  for (const name of ASSET_DIR_NAMES) {
    const candidate = path.join(cwd, name)
    try {
      if (fs.statSync(candidate).isDirectory()) return true
    } catch {
      continue
    }
  }
  return false
}

export const detect = async (cwd: string, opts: DetectOptions = {}): Promise<DetectionReport> => {
  const { deps, hasFile } = readPackageJson(cwd)

  const matchedVisualDeps = VISUAL_DEPS.filter((d) => deps.includes(d))
  const detectedDeps = [...matchedVisualDeps].sort()

  const hasDesignMd = fs.existsSync(path.join(cwd, ".ridgeline", "design.md"))
  const hasAssetDir = detectAssetDir(cwd)

  const visualFileExts = matchedVisualDeps.length > 0 ? [] : findVisualFileExts(cwd)
  const isVisualSurface = matchedVisualDeps.length > 0 || visualFileExts.length > 0

  let projectType: ProjectType
  if (!hasFile) projectType = "unknown"
  else if (isVisualSurface) projectType = "web"
  else projectType = "node"

  const suggestedSensors: SensorName[] = isVisualSurface ? [...SENSOR_ORDER] : []
  const suggestedEnsembleSize: 1 | 2 | 3 = opts.specialistCount ?? 3

  return {
    projectType,
    isVisualSurface,
    detectedDeps,
    visualFileExts,
    hasDesignMd,
    hasAssetDir,
    suggestedSensors,
    suggestedEnsembleSize,
  }
}
