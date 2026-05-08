---
depends_on: [01-foundation-baseline]
---

# Phase 3: Trajectory, checkpoint, and budget adapters

## Goal

Implement the three ridgeline-side adapters that conform to fascicle
contracts and route side effects through `ctx.trajectory`, while preserving
ridgeline's existing on-disk formats byte-for-byte:

1. A `TrajectoryLogger` that translates fascicle `TrajectoryEvent` shapes
   into ridgeline's existing on-disk `.jsonl` event schema, writing to
   `.ridgeline/builds/<name>/trajectory.jsonl`. Translation (not verbatim
   pass-through) is the explicit decision to preserve fascicle-viewer and
   external `.jsonl` consumer back-compat.
2. A per-step intra-run `CheckpointStore` scoped under
   `.ridgeline/builds/<name>/state/<step-id>.json`. This layer never
   touches the existing outer cross-process resume files (`state.json`, git
   tags) — those remain owned by `src/stores/state.ts` and
   `src/stores/tags.ts`.
3. A budget subscriber that listens for cost events on `ctx.trajectory` and
   tallies them into the existing `budget.json` format.

By phase exit, `src/stores/budget.ts` and `src/stores/trajectory.ts` are
wrapped so cost/event flow goes through `ctx.trajectory` while the
underlying file writers remain unchanged. Direct call sites for
`recordCost(...)` and `logTrajectory(...)` that have not yet been routed
through `ctx.trajectory` are tracked in
`phase-3-deferred-callsites.md` for resolution in later phases.

## Context

This phase runs in parallel with Phase 2. Both depend only on Phase 1's
scaffold. Phase 4 (engine factory) consumes the adapter types but not the
adapter instances directly — the adapters are passed into `run(flow, input,
opts)` per command invocation, not into `create_engine`.

The two-tier resume model is a load-bearing invariant: the new
`CheckpointStore` is purely intra-run memoization for step retries within a
single process; cross-process resume continues to span processes via
`state.json` + tags exactly as before. The two layers must never share files
or directories.

## Acceptance Criteria

1. `src/engine/adapters/` contains exactly: `ridgeline_trajectory_logger.ts`,
   `ridgeline_checkpoint_store.ts`, `ridgeline_budget_subscriber.ts`, and
   `index.ts`. The barrel re-exports each adapter.
2. `ridgeline_trajectory_logger.ts` has a top-of-file single-line comment
   stating verbatim:
   `Translates fascicle TrajectoryEvent → ridgeline on-disk event shape (decision: translate, not verbatim — preserves fascicle-viewer and external .jsonl consumer back-compat).`
3. `ridgeline_trajectory_logger.ts` writes append-only to
   `.ridgeline/builds/<name>/trajectory.jsonl`. A fixture-replay test loads
   `.ridgeline/builds/fascicle-migration/baseline/fixtures/trajectory.jsonl`
   and asserts the adapter's output for the same logical sequence is
   byte-equal for every event type that exists pre-migration.
4. `ridgeline_checkpoint_store.ts` implements every method of fascicle's
   `CheckpointStore` interface (verified by `tsc` structural compatibility:
   the file type-checks when typed as `CheckpointStore`). It writes only
   under `.ridgeline/builds/<name>/state/<step-id>.json` — never under
   `.ridgeline/builds/<name>/state.json`. A unit test using a temp build
   directory asserts: (a) checkpoint hits return cached values across
   simulated step retries; (b) checkpoint misses fall through; (c) no
   write occurs to `state.json` on any path.
5. `ridgeline_budget_subscriber.ts` consumes cost events from
   `ctx.trajectory` and writes a `budget.json` whose `total_usd` matches
   the sum of received cost events to within `1e-9`. A fixture-replay test
   produces a `budget.json` byte-equal to
   `.ridgeline/builds/fascicle-migration/baseline/fixtures/budget.json` for
   the same input sequence. A duplicate-event test asserts the tally is
   idempotent on a duplicated cost event with the same event id.
6. Trajectory append-only atomicity: a unit test asserts that concurrent
   `emit(...)` calls from multiple Steps in the same process never produce
   interleaved partial JSON lines (each emitted line is atomic).
7. `src/stores/budget.ts` and `src/stores/trajectory.ts` are wrapped so
   cost/event flow routes through `ctx.trajectory`. The underlying file
   writers (the path resolution, the format) are unchanged — no schema or
   path differences appear in the produced `budget.json` or
   `trajectory.jsonl` for matching inputs.
8. `.ridgeline/builds/fascicle-migration/phase-3-deferred-callsites.md`
   lists every direct call site of `recordCost(` or `logTrajectory(` that
   has NOT yet been routed through `ctx.trajectory`. The file maps each
   call site to the phase that will resolve it (typically Phase 8 leaf
   flows or Phase 9 build/auto). After this phase, `grep` for
   `recordCost(` or `logTrajectory(` in `src/engine/` returns matches only
   in code listed in this deferred-callsites doc.
9. The two-tier resume invariant is asserted by a regression test: a fake
   step that writes a checkpoint via the adapter and a separate write to
   `state.json` via `src/stores/state.ts` produces two files at distinct
   paths with no overlap.
10. `npm run check` exits with zero status.
11. `ridgeline build` runs end-to-end and produces a `trajectory.jsonl`
    that fascicle-viewer can render (verified by piping through the
    fascicle-viewer bin or by structural assertion against the documented
    schema).
12. `.ridgeline/builds/fascicle-migration/phase-3-check.json` exists and is
    a verbatim copy of `.check/summary.json` at this phase's exit commit.

## Spec Reference

From `spec.md`, "Phase 1 — Trajectory, checkpoint, and budget adapters":
> Implement three ridgeline-side adapters in src/engine/adapters/ that
> conform to fascicle contracts: a TrajectoryLogger that writes to the
> existing `.ridgeline/builds/<name>/trajectory.jsonl` path translating
> fascicle TrajectoryEvent shapes into ridgeline's existing on-disk event
> schema; a CheckpointStore for per-step intra-run memoization scoped under
> `.ridgeline/builds/<name>/state/<step-id>.json`; and a budget subscriber
> that listens for cost events on `ctx.trajectory` and tallies them into
> budget.json.

From `constraints.md`, "Resume and Checkpoint Coexistence":
> Outer cross-process resume: `state.json` + git tags, owned exclusively by
> `src/stores/state.ts` and `src/stores/tags.ts`. Lifecycle unchanged.
> Intra-run per-step memoization: fascicle `CheckpointStore` writes only
> under `.ridgeline/builds/<name>/state/<step-id>.json`. Never touches
> `state.json` or git tags. The two layers must never overlap or share files.
