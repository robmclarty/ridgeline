# Reviewer Feedback: Phase 10-mutation-tests

## Failed Criteria

### Criterion 2
**Status:** FAIL
**Evidence:** baseline/mutation-score.json:6 still records captured: false, score: null. The pre-migration absolute score on src/engine/pipeline/ was NOT captured. _phase_10_attempts at line 25-31 documents the retry was 'blocked' by Stryker EPERM. Independently reproduced: npx stryker run stryker.baseline.config.mjs fails with AggregateError: EPERM on internalConnectMultiple inside child-process-proxy IPC.
**Required state:** baseline/mutation-score.json must record captured: true with a numeric score for src/engine/pipeline/ produced by a successful Stryker run. The run must execute outside greywall (the only path that works for this codebase, per the builder's diagnosis) before Phase 11 removes the pipeline directory. The harness should pause so the operator can run the documented host-side recipe (stryker.baseline.config.mjs + scripts/phase-10-record-baseline.mjs) and re-enter the build loop.

### Criterion 3
**Status:** FAIL
**Evidence:** phase-10-mutation-score.json:4-7 records captured: false, score: null. No new Stryker run produced a mutation score on the new scope. The artifact exists at the expected path but contains a placeholder, not a numeric score.
**Required state:** phase-10-mutation-score.json must record captured: true with a numeric score for the new scope, produced by a successful host-side Stryker run.

### Criterion 4
**Status:** FAIL
**Evidence:** scripts/phase-10-mutation-gate.mjs exists and runs (verified: returns 'DEFERRED' exit 0 when both scores are captured:false). However, AC4 requires 'A dedicated assertion ... fails the phase exit if the new score is lower' — the gate cannot assert anything because both inputs are missing. The DEFERRED branch effectively allows the phase to ship with no comparison ever performed; this contradicts the spec's intent that Phase 10 lands BEFORE Phase 11 specifically so the captured baseline is still possible to obtain.
**Required state:** Once both score files have captured: true (after the host-side runs in criteria 2 and 3), the gate must execute the numeric comparison and confirm new_score >= baseline_score. The DEFERRED branch is acceptable as a transient state, but the phase exit gate cannot be cleared while DEFERRED is still the answer.

## Issues

- Pre-migration Stryker mutation score on src/engine/pipeline/ was not captured. Phase 10's Required Tools section mandates one of two paths (RIDGELINE_SANDBOX=0 OR vitest pool: 'forks' for coverageAnalysis: 'perTest'); the builder confirmed neither is sufficient under greywall — Stryker core's logging-server uses TCP-localhost IPC at @stryker-mutator/core/dist/src/logging/logging-client.js:20 that greywall denies at the syscall level (EPERM on internalConnectMultiple). Independently reproduced by running `npx stryker run stryker.baseline.config.mjs --concurrency 1 --dryRunOnly`. The captured: false state is preserved in baseline/mutation-score.json. Phase 10's stated rationale is that this capture MUST happen before Phase 11 deletes src/engine/pipeline/; deferring it forward defeats the phase's purpose. (.ridgeline/builds/fascicle-migration/baseline/mutation-score.json)
  - **Required:** baseline/mutation-score.json must record captured: true with a numeric score for src/engine/pipeline/ produced by a successful Stryker run. The run must execute outside greywall (the only path that works for this codebase, per the builder's diagnosis) before Phase 11 removes the pipeline directory. The harness should pause so the operator can run the documented host-side recipe (stryker.baseline.config.mjs + scripts/phase-10-record-baseline.mjs) and re-enter the build loop.
- Post-migration Stryker mutation score on src/engine/{flows,atoms,composites,adapters}/**/*.ts was not captured. Same root cause as criterion 2 — Stryker cannot run under the active sandbox. phase-10-mutation-score.json contains placeholders only (captured: false, score: null). (.ridgeline/builds/fascicle-migration/phase-10-mutation-score.json)
  - **Required:** phase-10-mutation-score.json must record captured: true with a numeric score for the new scope, produced by a successful host-side Stryker run.
- The mutation gate script exits 0 with status DEFERRED whenever either input is captured: false. Per AC4 the assertion must compare two numbers and fail the phase exit if the new score is lower — but with no numbers present, no comparison is possible and the gate trivially passes. As written, the phase could ship with the scores never captured at all, which contradicts the spec's explicit ordering rationale. (scripts/phase-10-mutation-gate.mjs)
  - **Required:** Once both score files have captured: true (after the host-side runs in criteria 2 and 3), the gate must execute the numeric comparison and confirm new_score >= baseline_score. The DEFERRED branch is acceptable as a transient state, but the phase exit gate cannot be cleared while DEFERRED is still the answer.

## What Passed

- Criterion 1: stryker.config.mjs:23-32 mutate glob is exactly src/engine/{flows,atoms,composites,adapters}/**/*.ts with __tests__/spec/d.ts excludes. Verified by reading stryker.config.mjs.
- Criterion 5: phase-10-composite-test-counts.json shows ok: true, all 5 composites at count=5 (≥4 threshold). Verified by running scripts/phase-10-test-count-audit.mjs: phase, graph_drain, worktree_isolated, diff_review, cost_capped each at 5.
- Criterion 6: phase-10-atom-test-counts.json shows ok: true, all 10 atoms at count ≥ 1. Verified: builder/reviewer/planner/specialist/specifier/sensors.collect/plan.review/specialist.verdict at 2; refiner/researcher at 1.
- Criterion 7: Verifier ran `npm run check` — exit 0, all 8 sub-checks green (types 2238ms, lint 534ms, struct 277ms, agents 249ms, dead 768ms, docs 820ms, spell 1903ms, test 6484ms).
- Criterion 8: Verifier ran `node dist/main.js --help` — exit 0, banner renders ('Build harness for long-horizon software execution'). Binary is operational.
- Criterion 9: phase-10-check.json exists at the expected path. It captures the .check/summary.json snapshot at this phase's exit commit (timestamp 2026-05-07T06:39:36). All 8 sub-checks ok:true. (A fresh `npm run check` necessarily produces a different timestamp, but that's expected — AC9 binds to the exit-commit snapshot, which this artifact preserves.)
