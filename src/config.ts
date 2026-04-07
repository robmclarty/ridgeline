import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig } from "./types"
import { resolveFile, parseCheckCommand } from "./store/inputs"
import { resolveNetworkAllowlist } from "./store/settings"

// Load version from package.json at runtime
export const loadVersion = (): string => {
  // Try dist location first (installed), then source root
  for (const rel of [path.join(__dirname, "..", "package.json"), path.join(__dirname, "..", "..", "package.json")]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(rel, "utf-8"))
      if (pkg.version) return pkg.version
    } catch {
      // Try next path
    }
  }
  return "0.0.0"
}

// Build RidgelineConfig from command options
export const resolveConfig = (buildName: string, opts: Record<string, string | boolean | undefined>): RidgelineConfig => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = path.join(ridgelineDir, "builds", buildName)
  const phasesDir = path.join(buildDir, "phases")

  const constraintsPath = resolveFile(
    opts.constraints as string | undefined,
    buildDir,
    "constraints.md",
    ridgelineDir
  )
  if (!constraintsPath) {
    throw new Error(
      `constraints.md not found. Checked:\n` +
      `  - ${buildDir}/constraints.md\n` +
      `  - ${ridgelineDir}/constraints.md\n` +
      `Create one with 'ridgeline shape ${buildName}' then 'ridgeline spec ${buildName}', or pass --constraints <path>`
    )
  }

  const tastePath = resolveFile(
    opts.taste as string | undefined,
    buildDir,
    "taste.md",
    ridgelineDir
  )

  const checkCommand = (opts.check as string) ?? parseCheckCommand(constraintsPath)

  return {
    buildName,
    ridgelineDir,
    buildDir,
    constraintsPath,
    tastePath,
    handoffPath: path.join(buildDir, "handoff.md"),
    phasesDir,
    model: (opts.model as string) ?? "opus",
    maxRetries: parseInt(String(opts.maxRetries ?? "2"), 10),
    timeoutMinutes: parseInt(String(opts.timeout ?? "120"), 10),
    checkTimeoutSeconds: parseInt(String(opts.checkTimeout ?? "1200"), 10),
    checkCommand,
    maxBudgetUsd: opts.maxBudgetUsd ? parseFloat(String(opts.maxBudgetUsd)) : null,
    unsafe: opts.unsafe === true,
    networkAllowlist: resolveNetworkAllowlist(ridgelineDir),
    worktreePath: null,
    extraContext: (opts.context as string) ?? null,
  }
}
