export { resolveAgentPrompt } from './claude/agent.prompt'
export {
  type DiscoveredAgent,
  parseFrontmatter,
  discoverAgentsInDir,
  discoverBuiltinAgents,
  buildAgentsFlag,
} from './discovery/agent.scan'
export { invokeBuilder } from './pipeline/build.exec'
export { type InvokeOptions, invokeClaude } from './claude/claude.exec'
export { runPhase } from './pipeline/phase.sequence'
export { invokePlanner } from './pipeline/ensemble.exec'
export {
  discoverPluginDirs,
  cleanupPluginDirs,
} from './discovery/plugin.scan'
export { invokeReviewer } from './pipeline/review.exec'
export {
  parseStreamLine,
  createStreamHandler,
  extractResult,
  createDisplayCallbacks,
} from './claude/stream.decode'
