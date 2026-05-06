import * as fs from "node:fs"
import * as path from "node:path"
import { RidgelineConfig } from "./types"
import { resolveFile, parseCheckCommand } from "./stores/inputs"
import {
  resolveNetworkAllowlist,
  resolveModel,
  resolveSpecialistTimeoutSeconds,
  resolvePhaseBudgetLimit,
  resolvePhaseTokenLimit,
  resolveSpecialistCount,
  resolveSandboxMode,
  resolveSandboxExtras,
  resolveTimeoutMinutes,
  resolveRequirePhaseApproval,
} from "./stores/settings"

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

/** Resolve (and optionally create) the build directory for a given build name. */
export const resolveBuildDir = (buildName: string, { ensure = false } = {}): string => {
  const buildDir = path.join(process.cwd(), ".ridgeline", "builds", buildName)
  if (ensure) fs.mkdirSync(path.join(buildDir, "phases"), { recursive: true })
  return buildDir
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

  const specialistCliOverride = opts.specialists !== undefined
    ? parseInt(String(opts.specialists), 10)
    : opts.thorough === true || opts.deepEnsemble === true
      ? 3
      : undefined
  const specialistCount = resolveSpecialistCount(ridgelineDir, specialistCliOverride)

  // --unsafe is the legacy alias for --sandbox=off
  const sandboxCliOverride = opts.unsafe === true
    ? "off"
    : (opts.sandbox as string | undefined)
  const sandboxMode = resolveSandboxMode(ridgelineDir, sandboxCliOverride)

  return {
    buildName,
    ridgelineDir,
    buildDir,
    constraintsPath,
    tastePath,
    handoffPath: path.join(buildDir, "handoff.md"),
    phasesDir,
    model: resolveModel(opts.model as string | undefined, ridgelineDir),
    maxRetries: parseInt(String(opts.maxRetries ?? "2"), 10),
    timeoutMinutes: resolveTimeoutMinutes(ridgelineDir, opts.timeout as string | undefined, 120),
    checkTimeoutSeconds: parseInt(String(opts.checkTimeout ?? "1200"), 10),
    checkCommand,
    maxBudgetUsd: opts.maxBudgetUsd ? parseFloat(String(opts.maxBudgetUsd)) : null,
    unsafe: sandboxMode === "off",
    sandboxMode,
    sandboxExtras: resolveSandboxExtras(ridgelineDir),
    networkAllowlist: resolveNetworkAllowlist(ridgelineDir),
    extraContext: (opts.context as string) ?? null,
    specialistCount,
    specialistTimeoutSeconds: resolveSpecialistTimeoutSeconds(ridgelineDir),
    phaseBudgetLimit: resolvePhaseBudgetLimit(ridgelineDir),
    phaseTokenLimit: resolvePhaseTokenLimit(ridgelineDir),
    requirePhaseApproval: resolveRequirePhaseApproval(
      ridgelineDir,
      opts.requirePhaseApproval as boolean | undefined,
    ),
  }
}
