import * as fs from "node:fs"
import * as path from "node:path"
import type { RidgelineConfig } from "../types.js"
import { resolveSearchConfig } from "../stores/settings.js"
import type { ToolFactoryContext, WebSearchBackends } from "./tools/types.js"

/**
 * Resolve prompt inputs from disk/config for the engine-backed executors,
 * matching how the spawn path's `legacy-shared` helpers read the same files.
 * Returning the raw strings (or null when absent) lets the atom shapers — the
 * single source of truth for prompt assembly — produce byte-identical prompts
 * to the spawn path.
 */

const readIfExists = (filePath: string): string | null =>
  fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null

export const resolveSpecMd = (config: RidgelineConfig): string =>
  fs.readFileSync(path.join(config.buildDir, "spec.md"), "utf-8")

export const resolveConstraintsMd = (config: RidgelineConfig): string =>
  fs.readFileSync(config.constraintsPath, "utf-8")

export const resolveTasteMd = (config: RidgelineConfig): string | null =>
  config.tastePath ? readIfExists(config.tastePath) : null

/** Project-level design doc (`.ridgeline/design.md`). */
export const resolveProjectDesignMd = (config: RidgelineConfig): string | null =>
  readIfExists(path.join(config.ridgelineDir, "design.md"))

/** Feature-level design doc (`<buildDir>/design.md`). */
export const resolveFeatureDesignMd = (config: RidgelineConfig): string | null =>
  readIfExists(path.join(config.buildDir, "design.md"))

/** Map the settings `search` block to the tool context's opt-in backends. */
export const resolveSearchBackends = (ridgelineDir: string): WebSearchBackends => {
  const sc = resolveSearchConfig(ridgelineDir)
  return { searxngUrl: sc.url, duckduckgo: sc.duckduckgo }
}

/**
 * Full sandboxed tool context for engine-backed executors that may run `Bash`
 * (reviewer/builder). Sandbox wiring comes straight from the config the spawn
 * path uses; `buildDir` is always writable.
 */
export const toolContextFromConfig = (config: RidgelineConfig, cwd?: string): ToolFactoryContext => ({
  cwd: cwd ?? process.cwd(),
  sandboxProvider: config.sandboxProvider ?? null,
  sandboxMode: config.sandboxMode,
  sandboxExtras: config.sandboxExtras,
  networkAllowlist: config.networkAllowlist,
  additionalWritePaths: [config.buildDir],
  search: resolveSearchBackends(config.ridgelineDir),
})

/**
 * Minimal context for executors whose surface has no `Bash` (e.g. refiner =
 * Read/Write, researcher = Read/WebFetch) — no greywall sandbox is needed since
 * the fs tools are scoped in-process and `WebFetch` self-enforces the network
 * allowlist. `Bash` is auto-dropped here because `sandboxProvider` is null.
 */
export const nonSandboxedToolContext = (
  cwd: string,
  additionalWritePaths?: readonly string[],
  networkAllowlist: readonly string[] = [],
  search?: WebSearchBackends,
): ToolFactoryContext => ({
  cwd,
  sandboxProvider: null,
  sandboxMode: "off",
  sandboxExtras: { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
  networkAllowlist,
  additionalWritePaths,
  search,
})
