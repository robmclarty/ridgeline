// Resolved CLI flags + file paths for a build run
export type RidgelineConfig = {
  buildName: string
  ridgelineDir: string
  buildDir: string
  constraintsPath: string
  tastePath: string | null
  handoffPath: string
  phasesDir: string
  model: string
  maxRetries: number
  timeoutMinutes: number
  checkTimeoutSeconds: number
  checkCommand: string | null
  maxBudgetUsd: number | null
  unsafe: boolean
  networkAllowlist: string[]
  sandboxProvider?: import("./engine/claude/sandbox").SandboxProvider | null
  worktreePath: string | null
}

// Phase metadata parsed from filesystem
export type PhaseInfo = {
  id: string         // "01-scaffold"
  index: number      // 1
  slug: string       // "scaffold"
  filename: string   // "01-scaffold.md"
  filepath: string   // absolute path
}

// Per-phase state persisted in state.json
export type PhaseState = {
  id: string
  status: "pending" | "building" | "reviewing" | "complete" | "failed"
  checkpointTag: string
  completionTag: string | null
  retries: number
  duration: number | null
  completedAt: string | null
  failedAt: string | null
}

// Full state.json structure
export type BuildState = {
  buildName: string
  startedAt: string
  phases: PhaseState[]
}

// Parsed result from claude --print --output-format json
export type ClaudeResult = {
  success: boolean
  result: string
  durationMs: number
  costUsd: number
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
  }
  sessionId: string
}

// Structured issue from reviewer
export type ReviewIssue = {
  criterion?: number
  description: string
  file?: string
  severity: "blocking" | "suggestion"
  requiredState?: string
}

// Reviewer's structured verdict
export type ReviewVerdict = {
  passed: boolean
  summary: string
  criteriaResults: {
    criterion: number
    passed: boolean
    notes: string
  }[]
  issues: ReviewIssue[]
  suggestions: ReviewIssue[]
}

// A single proposed phase from a specialist planner
type SpecialistPhaseProposal = {
  title: string
  slug: string
  goal: string
  acceptanceCriteria: string[]
  specReference: string
  rationale: string
}

// Full proposal from one specialist planner
export type SpecialistProposal = {
  perspective: string
  summary: string
  phases: SpecialistPhaseProposal[]
  tradeoffs: string
}

// Aggregate result from ensemble planning
export type EnsemblePlanResult = {
  specialistResults: ClaudeResult[]
  synthesizerResult: ClaudeResult
  totalCostUsd: number
  totalDurationMs: number
}

// Single entry in budget.json
export type BudgetEntry = {
  phase: string
  role: "planner" | "builder" | "reviewer" | "specialist" | "synthesizer"
  attempt: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  durationMs: number
  timestamp: string
}

// Full budget.json structure
export type BudgetState = {
  entries: BudgetEntry[]
  totalCostUsd: number
}

// Single entry in trajectory.jsonl
export type TrajectoryEntry = {
  timestamp: string
  type:
    | "plan_start"
    | "plan_complete"
    | "build_start"
    | "build_complete"
    | "review_start"
    | "review_complete"
    | "phase_advance"
    | "phase_fail"
    | "budget_exceeded"
  phaseId: string | null
  duration: number | null
  tokens: { input: number; output: number } | null
  costUsd: number | null
  summary: string
}
