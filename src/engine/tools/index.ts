export {
  type ToolFactoryContext,
  defineTool,
  pathScopeError,
  isPathScopeError,
} from "./types.js"
export { resolveWithinRoot, resolveWithinRoots } from "./path-scope.js"
export { buildToolSurface, buildTools, type ExecutorRole, type ToolName } from "./factory.js"
export { makeReadTool } from "./read.tool.js"
export { makeGlobTool } from "./glob.tool.js"
export { makeGrepTool } from "./grep.tool.js"
export { makeWriteTool } from "./write.tool.js"
export { makeEditTool } from "./edit.tool.js"
export { makeBashTool, killAllBashSync } from "./bash.tool.js"
export { makeWebFetchTool } from "./webfetch.tool.js"
export { makeWebSearchTool } from "./websearch.tool.js"
