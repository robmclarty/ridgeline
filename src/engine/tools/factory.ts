import type { Tool } from "fascicle"
import type { ToolFactoryContext } from "./types.js"
import { makeReadTool } from "./read.tool.js"
import { makeGlobTool } from "./glob.tool.js"
import { makeGrepTool } from "./grep.tool.js"
import { makeWriteTool } from "./write.tool.js"
import { makeEditTool } from "./edit.tool.js"
import { makeBashTool } from "./bash.tool.js"
import { makeWebFetchTool } from "./webfetch.tool.js"
import { makeWebSearchTool } from "./websearch.tool.js"

export type ToolName = "Read" | "Glob" | "Grep" | "Write" | "Edit" | "Bash" | "WebFetch" | "WebSearch"

/** Engine-backed executors that need an in-process tool surface. */
export type ExecutorRole =
  | "builder"
  | "reviewer"
  | "refiner"
  | "researcher"
  | "planner"
  | "plan_reviewer"
  | "plan_reviser"
  | "retrospective"

/**
 * Tool subset per role, mirroring the legacy `allowedTools` each spawn executor
 * passed to the Claude CLI — minus `Agent`/`Skill`, which stay claude_cli-only
 * in the first cut. Data-driven so widening a role is a one-line edit, not a new
 * flag (CLAUDE.md: fold capability into defaults).
 */
const ROLE_TOOLS: Record<ExecutorRole, readonly ToolName[]> = {
  builder: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  reviewer: ["Read", "Bash", "Glob", "Grep"],
  refiner: ["Read", "Write"],
  // WebFetch covers source retrieval; WebSearch (discovery) is opt-in and
  // dropped unless a search backend is configured.
  researcher: ["Read", "Glob", "Grep", "WebFetch", "WebSearch"],
  planner: ["Read", "Glob", "Grep"],
  plan_reviewer: ["Read", "Glob", "Grep"],
  plan_reviser: ["Read", "Write", "Glob", "Grep"],
  retrospective: ["Read", "Glob", "Grep"],
}

const CONSTRUCTORS: Record<ToolName, (ctx: ToolFactoryContext) => Tool> = {
  Read: makeReadTool,
  Glob: makeGlobTool,
  Grep: makeGrepTool,
  Write: makeWriteTool,
  Edit: makeEditTool,
  Bash: makeBashTool,
  WebFetch: makeWebFetchTool,
  WebSearch: makeWebSearchTool,
}

const hasSearchBackend = (ctx: ToolFactoryContext): boolean =>
  Boolean(ctx.search?.searxngUrl || ctx.search?.duckduckgo)

const KNOWN_TOOL_NAMES = new Set<string>(Object.keys(CONSTRUCTORS))

const isToolName = (name: string): name is ToolName => KNOWN_TOOL_NAMES.has(name)

const select = (names: readonly string[], ctx: ToolFactoryContext): Tool[] => {
  const sandboxOff = ctx.sandboxProvider === null
  return (
    names
      // Drop tools with no in-process implementation (e.g. Agent/Skill, claude_cli-only).
      .filter(isToolName)
      // Hard gate: never hand a non-Claude provider unsandboxed shell access.
      .filter((name) => !(name === "Bash" && sandboxOff))
      // Opt-in: WebSearch is offered only when a search backend is configured.
      .filter((name) => !(name === "WebSearch" && !hasSearchBackend(ctx)))
      .map((name) => CONSTRUCTORS[name](ctx))
  )
}

/**
 * Build the in-process tool surface for an executor role. `Agent`/`Skill` are
 * intentionally absent (claude_cli-only); `Bash` is omitted when no sandbox
 * provider is active.
 */
export const buildToolSurface = (role: ExecutorRole, ctx: ToolFactoryContext): Tool[] =>
  select(ROLE_TOOLS[role], ctx)

/**
 * Build tools from arbitrary tool-name strings — unknown names (e.g. the
 * claude_cli-only `Agent`/`Skill`) are silently dropped. Escape hatch for
 * callers that hold allowlists of legacy tool names.
 */
export const buildTools = (names: readonly string[], ctx: ToolFactoryContext): Tool[] =>
  select(names, ctx)
