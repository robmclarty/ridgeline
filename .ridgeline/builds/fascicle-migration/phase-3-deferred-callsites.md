# Phase 3 — Deferred call sites for `recordCost(` / `logTrajectory(`

This phase added the three trajectory/budget adapters and the wrapper
functions in `stores/trajectory.ts` and `stores/budget.ts`, but did not
rewrite every call site that already calls the legacy direct-write
helpers. The call sites listed below remain in place and route to disk
through the legacy path — they will be migrated to `ctx.trajectory` as
part of later phases when the surrounding code is ported to fascicle
flows. The acceptance criterion that `grep recordCost(|logTrajectory(`
in `src/engine/` returns matches only in code listed here is satisfied
by this enumeration.

Test files under `src/engine/adapters/__tests__/` exercise the legacy
helpers intentionally to assert byte-equal output between the legacy
and adapter paths. They are not "deferred" in the migration sense —
they are regression coverage and stay in the repo.

## Deferred — production code

| File:line | Symbol | Resolves in |
|---|---|---|
| `src/engine/claude/claude.exec.ts:115` | `logTrajectory(prompt_stable_hash)` | Phase 8 (atoms migration) — `claude.exec.ts` is deleted and the prompt-hash event moves into the model_call atom path. |
| `src/engine/claude/claude.exec.ts:124` | `logTrajectory(prompt_stable_hash)` | Phase 8 (atoms migration) — see above. |
| `src/engine/pipeline/phase.sequence.ts:62` | `logTrajectory(<error event>)` | Phase 9 (build/auto flow migration) — the entire `phase.sequence.ts` module is replaced by the `phase` Tier 1 composite; emission moves to `ctx.trajectory`. |
| `src/engine/pipeline/phase.sequence.ts:78` | `logTrajectory("budget_exceeded")` | Phase 9 — replaced by the `cost_capped` Tier 1 composite emitting cost-cap events. |
| `src/engine/pipeline/phase.sequence.ts:325` | `logTrajectory("build_start")` | Phase 9 — phase composite emits start/complete via `ctx.trajectory`. |
| `src/engine/pipeline/phase.sequence.ts:350` | `logTrajectory("builder_continuation")` | Phase 9 — builder loop in the phase composite emits via `ctx.trajectory`. |
| `src/engine/pipeline/phase.sequence.ts:354` | `logTrajectory("build_complete")` | Phase 9 — see above. |
| `src/engine/pipeline/phase.sequence.ts:357` | `recordCost("builder")` | Phase 9 — builder atom emits cost via `emitCostEntry(ctx.trajectory, ...)`. |
| `src/engine/pipeline/phase.sequence.ts:360` | `logTrajectory("builder_no_progress")` | Phase 9 — see above. |
| `src/engine/pipeline/phase.sequence.ts:366` | `logTrajectory("builder_loop_complete")` | Phase 9 — see above. |
| `src/engine/pipeline/phase.sequence.ts:414` | `logTrajectory("review_start")` | Phase 9 — phase composite reviewer hook. |
| `src/engine/pipeline/phase.sequence.ts:420` | `logTrajectory("review_complete")` | Phase 9 — see above. |
| `src/engine/pipeline/phase.sequence.ts:422` | `recordCost("reviewer")` | Phase 9 — reviewer atom emits cost. |
| `src/engine/pipeline/phase.sequence.ts:444` | `logTrajectory("phase_fail")` | Phase 9 — phase composite emits failure. |
| `src/engine/pipeline/phase.sequence.ts:537` | `logTrajectory("phase_advance")` | Phase 9 — phase composite emits advance. |
| `src/engine/pipeline/plan.review.ts:124` | `logTrajectory("plan_complete")` | Phase 8/9 — plan flow migration; plan.review becomes an atom in `src/engine/atoms/`. |
| `src/engine/pipeline/ensemble.exec.ts:181` | `logTrajectory("specialist_fail")` | Phase 8 — ensemble execution moves to fascicle's `ensemble` composite + ridgeline atoms. |
| `src/engine/pipeline/ensemble.exec.ts:419` | `logTrajectory("synthesis_skipped")` | Phase 8 — see above. |

## Already routed via the new wrappers (informational)

The legacy `recordCost` and `logTrajectory` helpers in `src/stores/`
have been refactored to call `appendBudgetEntry` and
`appendTrajectoryEntry` respectively. These low-level append helpers
are also used by the new adapters
(`createRidgelineTrajectoryLogger`, `createRidgelineBudgetSubscriber`)
so cost/event flow can route through `ctx.trajectory` while the
on-disk format stays owned by `src/stores/`. Existing public
signatures of `recordCost` and `logTrajectory` are unchanged.

## Out of scope for this list

Call sites in `src/commands/*.ts`, `src/__tests__/`,
`src/stores/__tests__/`, and `src/engine/adapters/__tests__/` are not
tracked here. The acceptance criterion only constrains
`src/engine/`. Command-level call sites are migrated alongside their
flows in Phase 8 (leaf commands) and Phase 9 (build/auto).
