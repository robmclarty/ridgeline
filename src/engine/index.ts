export {
  type DiscoveredAgent,
  parseFrontmatter,
  discoverAgentsInDir,
  buildAgentsFlag,
} from './discovery/agent.scan.js'
export { type SpecialistDef, buildAgentRegistry } from './discovery/agent.registry.js'
export { invokeBuilder } from './pipeline/build.exec.js'
export { type InvokeOptions, invokeClaude } from './claude/claude.exec.js'
export { runPhase } from './pipeline/phase.sequence.js'
export { invokePlanner } from './pipeline/ensemble.exec.js'
export {
  discoverPluginDirs,
  cleanupPluginDirs,
} from './discovery/plugin.scan.js'
export { invokeReviewer } from './pipeline/review.exec.js'
export {
  parseStreamLine,
  createStreamHandler,
} from './claude/stream.parse.js'
export { extractResult } from './claude/stream.result.js'
export { createDisplayCallbacks } from './claude/stream.display.js'
