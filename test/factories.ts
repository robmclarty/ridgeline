import type { RidgelineConfig, PhaseInfo, ClaudeResult, ReviewVerdict } from "../src/types.js"

export const makeConfig = (overrides?: Partial<RidgelineConfig>): RidgelineConfig => ({
  buildName: "test-build",
  ridgelineDir: "/tmp/ridgeline",
  buildDir: "/tmp/build",
  constraintsPath: "/tmp/constraints.md",
  tastePath: null,
  handoffPath: "/tmp/build/handoff.md",
  phasesDir: "/tmp/build/phases",
  model: "opus",
  maxRetries: 2,
  timeoutMinutes: 120,
  checkTimeoutSeconds: 1200,
  checkCommand: null,
  maxBudgetUsd: null,
  unsafe: false,
  sandboxMode: "semi-locked",
  sandboxExtras: { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
  networkAllowlist: [],
  extraContext: null,
  specialistCount: 2,
  specialistTimeoutSeconds: 180,
  phaseBudgetLimit: 15,
  phaseTokenLimit: 80000,
  requirePhaseApproval: false,
  ...overrides,
})

export const makePhase = (overrides?: Partial<PhaseInfo>): PhaseInfo => ({
  id: "01-scaffold",
  index: 1,
  slug: "scaffold",
  filename: "01-scaffold.md",
  filepath: "/tmp/build/phases/01-scaffold.md",
  dependsOn: [],
  ...overrides,
})

export const makeClaudeResult = (overrides?: Partial<ClaudeResult>): ClaudeResult => ({
  success: true,
  result: "done",
  durationMs: 5000,
  costUsd: 0.05,
  usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  sessionId: "sess-001",
  ...overrides,
})

export const passVerdict: ReviewVerdict = {
  passed: true,
  summary: "All good",
  criteriaResults: [{ criterion: 1, passed: true, notes: "ok" }],
  issues: [],
  suggestions: [],
  sensorFindings: [],
}
