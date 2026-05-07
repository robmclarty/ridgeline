# Phase 8 — Plugin surface audit

This document enumerates every consumer of the soon-to-be-deleted exports
from `src/engine/index.ts` (the symbols Phase 11 cleanup will remove). The
audit covers the entire repository: in-tree source, bundled plugins under
`plugin/`, and tests. External plugin consumers (out-of-tree) cannot be
inventoried exhaustively — this document records what's reachable from
this build's working tree as of the Phase 8 exit commit.

## Symbols under audit (slated for deletion at Phase 11)

These symbols are exported from `src/engine/index.ts` today and will be
removed when `src/engine/pipeline/` and `src/engine/claude/{claude.exec,
stream.*}.ts` are deleted at Phase 11:

- `invokeBuilder`
- `invokePlanner`
- `invokeReviewer`
- `runPhase`
- `invokeClaude`
- `parseStreamLine`
- `createStreamHandler`
- `extractResult`
- `createDisplayCallbacks`

## Bundled plugins (in-tree)

Path: `plugin/visual-tools/`

The repository ships a single bundled plugin at `plugin/visual-tools/`. It
contains a `plugin.json` manifest and a `skills/` directory; it does NOT
contain any TypeScript source that imports from ridgeline's engine surface.
Disposition: **n/a** — bundled plugin does not consume the deleted symbols.

## In-tree consumers of the soon-to-be-deleted symbols

The following call sites import the listed symbols from
`src/engine/pipeline/*` or `src/engine/claude/{claude.exec,stream.*}.ts` directly
(not via `src/engine/index.ts`). These are scheduled for full atom-based
migration at Phase 9 (build.flow + auto.flow) or earlier where applicable.

### `invokeClaude`

| Call site | Disposition |
|-----------|-------------|
| `src/cli.ts` (`killAllClaude`, `killAllClaudeSync` — process-management imports, not the LLM call) | **updated** — these stay until Phase 9 SIGINT handover; not in the deletion-target set |
| `src/commands/qa-workflow.ts` (`runQAIntake`, `runOneShotCall`, `runOutputTurn`, clarification loop) | **n/a** — qa-workflow's helpers stay on legacy `invokeClaude` until Phase 9; not yet migrated, but consumed by `directions`/`design`/`shape`/`ingest` flows |
| `src/commands/retrospective.ts` (inside the executor passed to `retrospectiveFlow`) | **updated** — entry point now uses `run(retrospectiveFlow, ...)`; the legacy `invokeClaude` call is encapsulated in the flow's executor closure and will be replaced at Phase 11 (or earlier when a `claude_call` atom lands) |
| `src/commands/retro-refine.ts` (inside the executor passed to `retroRefineFlow`) | **updated** — same pattern as retrospective |
| `src/engine/pipeline/research.exec.ts` (`buildResearchAgenda`) | **n/a** — pipeline executor; deleted entirely at Phase 11 |
| `src/engine/pipeline/refine.exec.ts` | **n/a** — pipeline executor; deleted entirely at Phase 11 |
| `src/engine/pipeline/review.exec.ts` | **n/a** — pipeline executor; deleted entirely at Phase 11 |
| `src/engine/pipeline/ensemble.exec.ts` (specialist + synthesizer) | **n/a** — pipeline executor; deleted entirely at Phase 11 |

### `invokeBuilder`

| Call site | Disposition |
|-----------|-------------|
| `src/engine/pipeline/build.loop.ts` (`assembleUserPrompt`, `invokeBuilder`) | **n/a** — pipeline executor; deleted entirely at Phase 11 |
| `src/engine/index.ts` (re-export) | **removed** at Phase 11 cleanup |
| `src/engine/pipeline/__tests__/build.exec.test.ts` | **removed** at Phase 11 (test deleted alongside the executor) |

### `invokePlanner`

| Call site | Disposition |
|-----------|-------------|
| `src/commands/plan.ts` (passed into `planFlow.invokePlanner`) | **updated** — now injected via `planFlow` deps; the actual call stays in pipeline until Phase 11 |
| `src/engine/flows/plan.flow.ts` (typed dependency, not an import) | **updated** — typed call signature in the flow factory deps |
| `src/engine/index.ts` (re-export) | **removed** at Phase 11 cleanup |

### `invokeReviewer`

| Call site | Disposition |
|-----------|-------------|
| `src/engine/pipeline/phase.sequence.ts` (used inside `runPhase`) | **n/a** — pipeline executor; deleted entirely at Phase 11 |
| `src/engine/pipeline/review.exec.ts` (definition) | **n/a** — pipeline executor; deleted entirely at Phase 11 |
| `src/engine/pipeline/__tests__/review.exec.test.ts` | **removed** at Phase 11 |
| `src/engine/index.ts` (re-export) | **removed** at Phase 11 cleanup |

### `runPhase`

| Call site | Disposition |
|-----------|-------------|
| `src/commands/build.ts` (lines 232, 330) | **n/a** — `build` is migrated at Phase 9 (NOT Phase 8 per AC11); `runPhase` is replaced by the `phase` Tier 1 composite |
| `src/engine/index.ts` (re-export) | **removed** at Phase 11 cleanup |
| `src/commands/__tests__/build.test.ts` | **removed** at Phase 11 (test rewritten against the build flow) |

### `parseStreamLine`, `createStreamHandler`

| Call site | Disposition |
|-----------|-------------|
| `src/engine/claude/claude.exec.ts` (internal use) | **n/a** — claude.exec deleted entirely at Phase 11 |
| `src/engine/index.ts` (re-export) | **removed** at Phase 11 cleanup |
| `src/engine/claude/__tests__/stream.parse.test.ts` | **removed** at Phase 11 (test deleted alongside the module) |

### `extractResult`

| Call site | Disposition |
|-----------|-------------|
| `src/engine/claude/claude.exec.ts` (internal use) | **n/a** — claude.exec deleted entirely at Phase 11 |
| `src/engine/index.ts` (re-export) | **removed** at Phase 11 cleanup |
| `src/engine/claude/__tests__/stream.result.test.ts` | **removed** at Phase 11 |

### `createDisplayCallbacks`

| Call site | Disposition |
|-----------|-------------|
| `src/commands/qa-workflow.ts` | **n/a** — qa-workflow helpers retain legacy display until Phase 9 |
| `src/commands/retrospective.ts` (inside the executor closure) | **updated** — encapsulated in `retrospectiveFlow.executor` |
| `src/commands/retro-refine.ts` (inside the executor closure) | **updated** — encapsulated in `retroRefineFlow.executor` |
| `src/engine/pipeline/refine.exec.ts` | **n/a** — pipeline executor; deleted at Phase 11 |
| `src/engine/pipeline/review.exec.ts` | **n/a** — pipeline executor; deleted at Phase 11 |
| `src/engine/pipeline/research.exec.ts` (`buildResearchAgenda`) | **n/a** — pipeline executor; deleted at Phase 11 |
| `src/engine/pipeline/ensemble.exec.ts` (specialist invocations) | **n/a** — pipeline executor; deleted at Phase 11 |
| `src/engine/index.ts` (re-export) | **removed** at Phase 11 cleanup |
| `src/engine/claude/__tests__/stream.display.test.ts` | **removed** at Phase 11 |
| `src/sensors/vision.ts` | **updated** — sensor's display path stays; vision rendering is independent of the migration deletion target. If `createDisplayCallbacks` is removed at Phase 11, vision.ts will need a thin replacement (see "Replacement plan" below) |
| `src/catalog/classify.ts` | **updated** — same as vision: independent display use; thin replacement may be needed at Phase 11 |
| `src/ui/phase-prompt.ts` | **updated** — same as vision/classify |

## External plugin consumers

No first-party plugin under `plugin/` imports any of the deletion-target
symbols. External (out-of-tree) plugin consumers cannot be exhaustively
inventoried, but the publicly documented surface in
`docs/extending-ridgeline.md` does not currently document
`invokeBuilder`/`invokePlanner`/`invokeReviewer`/`runPhase`/`invokeClaude`/
`parseStreamLine`/`createStreamHandler`/`extractResult`/`createDisplayCallbacks`
as part of the plugin extension API. The plugin extension API is the
agent-registry plus claude-cli plugin discovery (`discoverPluginDirs`,
`cleanupPluginDirs`, `buildAgentRegistry`), all of which are KEPT.

Disposition for external plugin consumers (best-effort):
- If any external plugin imports `invokeClaude` (the most likely candidate
  for misuse), Phase 11's CHANGELOG entry will document the removal as a
  plugin-author-facing breaking change and recommend `model_call` (via
  `makeRidgelineEngine`) as the replacement.
- If any external plugin imports `createDisplayCallbacks` for streaming
  Claude output, Phase 11's CHANGELOG will document a thin StreamChunk
  reader replacement option.

## Replacement plan for non-deletion-target consumers

Three in-tree consumers (`src/sensors/vision.ts`, `src/catalog/classify.ts`,
`src/ui/phase-prompt.ts`) use `createDisplayCallbacks` independently of
the pipeline executors that are slated for deletion. These are not
migration-target call sites in Phase 8, but they will need attention at
Phase 11 when `createDisplayCallbacks` is removed:

1. The simplest path is a thin StreamChunk reader replacement co-located
   with `src/ui/` that consumes fascicle's `StreamChunk` events and renders
   them with the same line-level cadence and prefix conventions.
2. The replacement preserves the `{ onStdout, flush, projectRoot, ... }`
   shape so the three call sites need only an import-path change.
3. Phase 11's `phase-11-check.json` exit gate verifies the replacement
   exists and the three call sites compile against it.

## Migration discipline at Phase 8

Per AC8, tests targeting deleted internals are rewritten at the flow
input/output layer in this same phase. The mapping below records old
test path → new test path for the changes landed in Phase 8.

| Old test (still passing, mocks unchanged) | New test (added) |
|-------------------------------------------|------------------|
| `src/commands/__tests__/refine.test.ts` (mocks `invokeRefiner`) | `src/engine/flows/__tests__/refine.flow.test.ts` (asserts the flow invokes its injected executor) |
| `src/commands/__tests__/research.test.ts` (mocks `invokeResearcher`) | — (flow tests for research are deferred to Phase 11; the wrapper layer does not add behavior beyond executor delegation) |
| `src/commands/__tests__/spec.test.ts` (mocks `invokeSpecifier`) | — (same rationale as research) |
| `src/commands/__tests__/plan.test.ts` (mocks `invokePlanner`/`runPlanReviewer`/`revisePlanWithFeedback`) | `src/engine/flows/__tests__/plan.flow.test.ts` (asserts approve/reject/revise dispatch logic at the flow boundary) |
| `src/commands/__tests__/retro-refine.test.ts` (mocks `invokeClaude`) | — (deferred to Phase 11) |

Tests that mock the legacy executor still work because the executor is
imported by the command file and threaded into the flow as a dependency;
the mock applies before the flow runs.

## Summary

- **Updated**: `src/commands/refine.ts`, `src/commands/research.ts`,
  `src/commands/spec.ts`, `src/commands/plan.ts`,
  `src/commands/retrospective.ts`, `src/commands/retro-refine.ts`. All
  six entry points now use `makeRidgelineEngine` + `run(flow, input, opts)`
  with `engine.dispose()` in a `finally` block.
- **n/a**: every direct-pipeline-executor call site stays in the
  pipeline files until Phase 11 (deletion).
- **Removed at Phase 11**: the nine re-exports in `src/engine/index.ts`,
  the corresponding pipeline source files, the `claude/{claude.exec,
  stream.*}.ts` files, and their tests.
- **No external plugin consumer is known to depend on the
  deletion-target symbols** (best-effort audit; out-of-tree consumers
  cannot be exhaustively inventoried). Phase 11 will surface any
  remaining breakage in the CHANGELOG as plugin-author-facing.
