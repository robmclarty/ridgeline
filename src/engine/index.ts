export {
  type DiscoveredAgent,
  parseFrontmatter,
  discoverAgentsInDir,
  buildAgentsFlag,
} from './discovery/agent.scan'
export { type SpecialistDef, buildAgentRegistry } from './discovery/agent.registry'
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
} from './claude/stream.parse'
export { extractResult } from './claude/stream.result'
export { createDisplayCallbacks } from './claude/stream.display'
