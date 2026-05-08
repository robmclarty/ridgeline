---
depends_on: [08-leaf-flows]
---

# Phase 9: Build flow, auto flow, SIGINT handover, dogfood gate

## Goal

Migrate `build` and `auto` — the highest-complexity orchestrations — to
fascicle flows under `src/engine/flows/build.flow.ts` and
`src/engine/flows/auto.flow.ts`. The build flow exercises every Tier 1
composite (`phase`, `graph_drain`, `worktree_isolated`, `diff_review`,
`cost_capped`); the auto flow exercises the autonomous loop driving
multi-build orchestration. With every command now running through
`run(flow, ...)`, remove the manual `process.on('SIGINT', ...)` handler in
`src/cli.ts` and rely on fascicle's runner default
`install_signal_handlers: true`. Migrate teardown (worktree cleanup, Claude
subprocess kill, plugin-dir cleanup, artifact flush) to
`ctx.on_cleanup(...)` registrations inside steps — no ad hoc teardown
registries remain.

The Phase 9 dogfood gate is the load-bearing exit criterion: a separately
installed stable ridgeline binary must successfully drive
`ridgeline build --auto` against this build's
`.ridgeline/builds/fascicle-migration/` directory end-to-end, recorded in
`dogfood-evidence.md`. That run is the proof that the substrate swap
preserves end-to-end behavior on the highest-complexity flow.

## Context

This phase consumes everything from Phases 3 through 8. After this phase,
no command path remains on the old pipeline — every command runs through
`run(flow, input, opts)`. Phase 10 (mutation testing) and Phase 11
(deletions) follow. The old `src/engine/pipeline/*.exec.ts` files are
still on disk but no command path imports them anymore.

The cross-process resume contract (state.json + git tags) is preserved: a
SIGINT mid-build stops the run with exit code 130, leaving state.json + tag
state intact, and a subsequent `ridgeline build` resumes from the
recorded checkpoint. The new fascicle `CheckpointStore` is purely intra-run
and never overlaps with the cross-process resume layer.

## Required Tools

A separately installed stable ridgeline binary is required to drive the
dogfood gate run. The binary under migration must never be invoked to
dogfood itself: the stable binary operates on a worktree of `main` and
issues `ridgeline build --auto` against
`.ridgeline/builds/fascicle-migration/`. Recording goes into
`dogfood-evidence.md`.

Standard test tooling (`npm run check`, vitest, vitest.e2e.config.ts) is
required for the SIGINT and resume regression tests. The SIGINT regression
test uses `ps`-style process inspection to verify no orphan claude
subprocesses remain post-SIGINT — this requires the test to run on a
platform where child-process inspection is reliable (the project's CI
target, macOS/Linux).

## Acceptance Criteria

1. `src/commands/build.ts` is a thin shell over a fascicle flow defined in
   `src/engine/flows/build.flow.ts`. The build flow exercises every Tier 1
   composite (`phase`, `graph_drain`, `worktree_isolated`, `diff_review`,
   `cost_capped`) — verified by an integration test inspecting trajectory
   events for each composite name.
2. `src/commands/auto.ts` is a thin shell over a fascicle flow defined in
   `src/engine/flows/auto.flow.ts`.
3. Each of `build.ts` and `auto.ts` follows the canonical entry-point
   shape: `makeRidgelineEngine(cfg)` then
   `try { await run(flow, input, opts) } finally { await engine.dispose() }`.
   The ast-grep dispose-in-finally rule from Phase 8 covers them.
4. `src/cli.ts` contains zero matches for `process.on('SIGINT'` or
   `process.on("SIGINT"` — verified by grep.
5. Every `commands/*.ts` call to `run(...)` either passes
   `install_signal_handlers: true` explicitly OR omits the key and relies
   on fascicle's default. A unit test asserts fascicle's default for that
   key is `true` at the pinned fascicle version (assertion runs against
   the imported runner's options resolution).
6. SIGINT regression E2E test: starts a `ridgeline build` in a child
   process, sends SIGINT after a configurable delay, and asserts:
   - (a) Child process exit code is exactly `130`.
   - (b) Any git worktrees created during the run are removed.
   - (c) No orphan claude subprocesses remain (verified by `ps`-style
     inspection in the test).
   - (d) No "double cleanup" messages or duplicate teardown errors are
     logged.
7. Cross-process resume E2E test: a `ridgeline build` is interrupted via
   SIGINT mid-phase; a fresh `ridgeline build` invocation resumes from
   the state.json + tag-based outer resume path; the resume continues
   to span processes (the CheckpointStore is per-step intra-run only and
   does not interfere).
8. Teardown is migrated from any pre-existing ad hoc registries to
   `ctx.on_cleanup(...)` registrations inside steps. After this phase,
   `grep` for `process.on('exit'` / `process.on('SIGTERM'` / similar in
   `src/engine/{flows,atoms,composites,adapters}/` and in the migrated
   `src/commands/{build,auto}.ts` returns zero matches.
9. Direct `console.*` and `process.stderr/stdout.write` are absent from
   any new code added in this phase under
   `src/engine/{flows,atoms,composites,adapters}/`. The ast-grep rule
   forbidding them (introduced earlier) covers any new additions.
10. Dogfood gate: a separately installed stable ridgeline binary drives
    `ridgeline build --auto` against
    `.ridgeline/builds/fascicle-migration/` to a successful end-to-end
    completion. The run is recorded in
    `.ridgeline/builds/fascicle-migration/dogfood-evidence.md` containing
    at minimum: a trajectory excerpt, the final state.json digest, and
    a timestamp. The dogfood run must complete without manual
    intervention.
11. After this phase, `ridgeline build` runs through `run(flow, ...)`,
    not through any code in `src/engine/pipeline/`. (The pipeline
    directory is still on disk but no command path imports it.)
12. `npm run check` exits with zero status.
13. `.ridgeline/builds/fascicle-migration/phase-9-check.json` exists and
    is a verbatim copy of `.check/summary.json` at this phase's exit
    commit.

## Spec Reference

From `spec.md`, "Phase 6 — Build flow, auto flow, and SIGINT handover":
> Migrate `build` and `auto` — the highest-complexity orchestrations — to
> fascicle flows that exercise every Tier 1 composite (phase, graph_drain,
> worktree_isolated, diff_review, cost_capped). Once every command runs
> through `run(flow, ...)`, remove the manual `process.on('SIGINT', ...)`
> handler in src/cli.ts and rely on fascicle's runner default
> `install_signal_handlers: true`. Migrate teardown to `ctx.on_cleanup(...)`
> registrations inside steps.

> `ridgeline build --auto` against this build's
> `.ridgeline/builds/fascicle-migration/` directory completes successfully
> end-to-end, dogfooding the migration; the run is recorded in
> `.ridgeline/builds/fascicle-migration/dogfood-evidence.md` (trajectory
> excerpt + final state.json digest + timestamp).
