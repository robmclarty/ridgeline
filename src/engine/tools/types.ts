import type { Tool, ToolExecContext } from "fascicle"
import type { spawn } from "node:child_process"
import type { z } from "zod"
import type { SandboxProvider } from "../claude/sandbox.types.js"
import type { SandboxMode, SandboxExtras } from "../../stores/settings.js"

/**
 * Everything a tool's `execute` closure needs that fascicle's `ToolExecContext`
 * does NOT provide. fascicle hands `execute` only `{abort, trajectory,
 * tool_call_id, step_index}` — it has no notion of a workspace root or sandbox.
 * So each tool is built by a factory that closes over this context: the build
 * cwd (the scope for every filesystem op) and the sandbox wiring the Bash tool
 * needs to wrap commands in greywall.
 */
/**
 * Opt-in web search backends for the `WebSearch` tool. When neither is set the
 * factory does not emit `WebSearch` at all (no default DuckDuckGo scraping).
 */
export type WebSearchBackends = {
  /** Self-hosted SearXNG base URL (JSON API). Tried first. */
  readonly searxngUrl?: string
  /** Explicit opt-in to the keyless DuckDuckGo HTML fallback. */
  readonly duckduckgo?: boolean
}

export type ToolFactoryContext = {
  /** Absolute workspace root. Build cwd or worktree dir; all fs ops scope here. */
  readonly cwd: string
  /** Active sandbox provider, or null when `--sandbox=off`/unavailable. */
  readonly sandboxProvider: SandboxProvider | null
  readonly sandboxMode: SandboxMode
  readonly sandboxExtras: SandboxExtras
  readonly networkAllowlist: readonly string[]
  /** Writable paths beyond cwd (e.g. a buildDir living outside cwd). */
  readonly additionalWritePaths?: readonly string[]
  /** Opt-in web search backends; absent → `WebSearch` is not offered. */
  readonly search?: WebSearchBackends
  /** Test seam: override the spawn used by the Bash tool. */
  readonly spawnFn?: typeof spawn
}

/** `Error.name` tag for path-scope violations (house style avoids error subclasses). */
const PATH_SCOPE_ERROR = "PathScopeError"

/** Build a path-scope violation error, tagged so callers can recognize it. */
export const pathScopeError = (requested: string, root: string): Error => {
  const err = new Error(`Path '${requested}' is outside the allowed workspace root '${root}'.`)
  err.name = PATH_SCOPE_ERROR
  return err
}

/** True when `err` was produced by {@link pathScopeError}. */
export const isPathScopeError = (err: unknown): err is Error =>
  err instanceof Error && err.name === PATH_SCOPE_ERROR

/**
 * Build a fascicle `Tool` from a strongly-typed spec. fascicle validates input
 * against `input_schema` before invoking `execute`, so `execute` receives data
 * already shaped as `z.infer<S>`. The single localized cast bridges the
 * specific `Tool<In, Out>` to the `Tool` (`Tool<unknown, unknown>`) array that
 * `engine.generate`/`model_call` accept — fascicle's `Tool[]` is invariant in
 * its input, so a per-tool widening cast here is the clean seam.
 */
export const defineTool = <S extends z.ZodType>(spec: {
  name: string
  description: string
  input_schema: S
  execute: (input: z.infer<S>, ctx: ToolExecContext) => Promise<unknown> | unknown
  needs_approval?: boolean
}): Tool => spec as unknown as Tool
