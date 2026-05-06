# Phase 2: Trajectory, Checkpoint, and Budget Adapters

## Goal

Bridge ridgeline's existing on-disk file formats to fascicle's runtime contracts. Three adapters in `src/engine/adapters/` translate between the two systems while keeping every on-disk artifact byte-equivalent to pre-migration output.

The trajectory logger is the load-bearing decision: it translates fascicle `TrajectoryEvent` shapes into ridgeline's existing `trajectory.jsonl` event schema (a deliberate translation, not verbatim emission, to preserve fascicle-viewer back-compat and any external `.jsonl` consumer contract). The choice is documented in a top-of-file comment so future readers see the rationale at the boundary. The checkpoint store implements fascicle's `CheckpointStore` interface for per-step intra-run memoization, scoped under `.ridgeline/builds/<name>/state/<step-id>.json`. It never touches the cross-process resume `state.json` or git tags — the two-tier resume model (outer `state.json` + tags vs. inner per-step files) is preserved exactly. The budget subscriber listens for cost events on `ctx.trajectory` and tallies them into `budget.json` with totals matching the previous implementation within 1e-9 USD and idempotent semantics on duplicate events.

`stores/budget.ts` and `stores/trajectory.ts` are wrapped (not rewritten) so cost/event flow goes through `ctx.trajectory`; the underlying file writers are unchanged. After this phase, the data plane is fascicle-ready while the on-disk artifacts remain byte-identical to the Phase 1 baselines.

## Context

Phase 1 captured the baseline `trajectory.jsonl`, `budget.json`, and `state.json` fixtures. This phase consumes those baselines as the regression net: every adapter has a fixture-replay test that asserts byte equality of the new code path's output. The legacy pipeline still runs every command; this phase only adds the adapter layer alongside it. No composite, atom, or flow consumes the adapters yet — they are unit-tested in isolation through the fascicle interfaces they implement.

The naming-convention boundary stays explicit: fascicle imports keep their snake_case identifiers (`TrajectoryLogger`, `CheckpointStore`, `TrajectoryEvent`, `RunContext`); ridgeline-side identifiers use camelCase. No alias re-exports.

## Acceptance Criteria

1. `src/engine/adapters/` contains exactly: `ridgeline_trajectory_logger.ts`, `ridgeline_checkpoint_store.ts`, `ridgeline_budget_subscriber.ts`, `index.ts`.
2. `ridgeline_trajectory_logger.ts` has a top-of-file comment matching: `Translates fascicle TrajectoryEvent → ridgeline on-disk event shape (decision: translate, not verbatim — preserves fascicle-viewer and external .jsonl consumer back-compat).`
3. `ridgeline_trajectory_logger.ts` writes only to `.ridgeline/builds/<name>/trajectory.jsonl` (verified by unit test against a tmpdir build path).
4. Fixture-replay test loads `.ridgeline/builds/fascicle-migration/baseline/fixtures/trajectory.jsonl`, replays each logical event through the new `TrajectoryLogger` adapter, and asserts the on-disk output is byte-equal to the baseline for every event type that existed pre-migration.
5. Trajectory-logger unit tests additionally cover: append-only atomicity (a partial write during a crash leaves a valid prefix, not a corrupted file); event-order preservation (events written in emission order); write-ahead semantics (events emitted before any consumer reads are preserved).
6. `ridgeline_checkpoint_store.ts` is structurally compatible with fascicle's `CheckpointStore` interface — verified by `tsc` strict-mode compilation against the imported interface (the file should not declare a duplicate of the interface; it should import and implement fascicle's).
7. `ridgeline_checkpoint_store.ts` writes only under `.ridgeline/builds/<name>/state/<step-id>.json` — never under `.ridgeline/builds/<name>/state.json` (verified by unit test that asserts no write to a path matching `state.json` regardless of input step-id).
8. Checkpoint-store unit tests cover: hit (returns cached value on second call with same step-id); miss (returns nothing on first call); retry (subsequent step retries see the prior partial value); write atomicity (concurrent writes do not corrupt the file).
9. `ridgeline_budget_subscriber.ts` produces a `budget.json` whose `total_usd` field matches the sum of cost events to within `1e-9` USD.
10. Budget-subscriber fixture-replay test produces a `budget.json` byte-equal to `.ridgeline/builds/fascicle-migration/baseline/fixtures/budget.json` for the recorded fixture cost-event sequence.
11. Budget-subscriber unit tests additionally cover: idempotency on duplicate cost events (same event id does not double-count); monotonic total (totals never decrease); concurrency (parallel cost emissions tally correctly).
12. `stores/budget.ts` and `stores/trajectory.ts` are wrapped (not rewritten) so cost/event flow goes through `ctx.trajectory`; the underlying file writers are unchanged. Verified by diff against pre-Phase-2 contents — the writer functions retain identical bodies; only the call sites that previously invoked them directly now route through the trajectory.
13. After Phase 2, `grep` for `recordCost(` and `logTrajectory(` (or their pre-migration equivalents) under `src/engine/` returns matches only in code that has been intentionally deferred to a later phase. Remaining direct call sites are enumerated in `.ridgeline/builds/fascicle-migration/phase-1-deferred-callsites.md` with one line per `file:line:reason`.
14. `src/engine/adapters/index.ts` re-exports the three adapter constructor functions plus any types ridgeline-side consumers will need. Re-exports use camelCase ridgeline-side names; no `export ... as <camelCaseName>` rewriting of fascicle-snake_case symbols (verified by ast-grep rule).
15. Ast-grep rule passes: zero `console.*` and zero `process.stdout.write` / `process.stderr.write` calls in `src/engine/adapters/`. New diagnostic events (if any) go through `ctx.trajectory.emit(...)`.
16. Ast-grep rule passes: zero emoji literals and zero new ANSI escape sequences in `src/engine/adapters/`.
17. `npm run check` is green.
18. `ridgeline build` runs end-to-end (still on the old pipeline) and produces a `trajectory.jsonl` that fascicle-viewer can render. The smoke check command is recorded in the phase-exit commit body.
19. `.ridgeline/builds/fascicle-migration/phase-1-check.json` captures a green `.check/summary.json` snapshot at the phase-exit commit.
20. The phase exit commit subject begins with `phase-1:`.

## Spec Reference

- spec.md → "Phase 1 — Trajectory, checkpoint, and budget adapters": three adapters, fixture-replay byte equality, two-tier resume preservation.
- spec.md → "Twelve invariants" — invariant 2 (file-format stability), invariant 6 (cross-process resume), invariant 11 (budget cap accuracy within 1e-9 USD).
- constraints.md → "Resume and Checkpoint Coexistence": outer cross-process resume vs. intra-run per-step memoization never overlap.
- taste.md → "Comment Style": adapter top-of-file comment recording the translate-not-verbatim decision.
- taste.md → "Test Patterns": fixture-replay tests load pre-migration recordings and assert byte equality.
