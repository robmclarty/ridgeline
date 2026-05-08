export {
  type DiscoveredAgent,
  parseFrontmatter,
  discoverAgentsInDir,
  buildAgentsFlag,
} from './discovery/agent.scan.js'
export { type SpecialistDef, buildAgentRegistry } from './discovery/agent.registry.js'
export {
  discoverPluginDirs,
  cleanupPluginDirs,
} from './discovery/plugin.scan.js'

export { makeRidgelineEngine, type RidgelineEngineConfig } from './engine.factory.js'

export { runClaudeOneShot, toClaudeResult, type RunClaudeOptions } from './claude.runner.js'

export { builderAtom, reviewerAtom, plannerAtom, refinerAtom, researcherAtom } from './atoms/index.js'
export { phase, graph_drain, worktree_isolated, diff_review, cost_capped } from './composites/index.js'
export {
  createRidgelineTrajectoryLogger,
  createRidgelineCheckpointStore,
  createRidgelineBudgetSubscriber,
} from './adapters/index.js'
export { buildFlow, autoFlow } from './flows/index.js'
