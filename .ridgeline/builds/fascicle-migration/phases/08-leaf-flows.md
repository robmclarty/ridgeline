---
depends_on: [03-adapters, 05-composites, 07-atoms-b]
---

# Phase 8: Leaf command flows

## Goal

Migrate every leaf CLI command — every `src/commands/<name>.ts` except
`build` and `auto` — to construct a fascicle flow under
`src/engine/flows/<command>.flow.ts` and call
`run(flow, input, opts)` inside a `try { ... } finally { await engine.dispose() }`
block. The Engine is constructed via `makeRidgelineEngine(cfg)`. The
adapter trio from Phase 3 (TrajectoryLogger, CheckpointStore, budget
subscriber) is wired into `run`'s `opts`. The composites from Phase 5 and
the atoms from Phases 6 and 7 are composed into the flows.

External signatures of every commands/*.ts exported function (the function
consumed by `src/main.ts`) are byte-equal to the Phase 1 baseline `.d.ts`
output. The CLI flag set is unchanged; `--help` output is byte-equal to the
baseline; existing E2E tests for each migrated command pass unchanged.

The manual `process.on('SIGINT', ...)` handler in `src/main.ts` is NOT
removed in this phase — `build` and `auto` still run on the old pipeline
until Phase 9, and the manual handler covers them. SIGINT migration
happens in Phase 9.

## Goal (continued — plugin surface audit)

`.ridgeline/builds/fascicle-migration/phase-8-plugin-surface-audit.md`
enumerates every plugin call site that depends on a soon-to-be-deleted
symbol (`invokeBuilder`, `invokePlanner`, `invokeReviewer`, `runPhase`,
`invokeClaude`, `parseStreamLine`, `createStreamHandler`, `extractResult`,
`createDisplayCallbacks`) with a per-site disposition
(`updated | removed | n/a`). This is the inventory Phase 11 (cleanup)
relies on to decide whether a thin StreamChunk-reader replacement is
required for any load-bearing plugin consumer.

## Context

This phase consumes the work of Phases 3, 5, 6, and 7 — adapters,
composites, and atoms must all be in place. Migrated commands per the
spec: `dry-run`, `research`, `plan`, `retro-refine`, `retrospective`,
`qa-workflow`, `directions`, `design`, `shape`, `spec`, `ingest`,
`refine`, `rewind`. (Inspect `catalog`, `check`, `clean`, `create`,
`input`, and `ui`: if they don't invoke pipeline executors, they are
unchanged.)

Tests targeting deleted internals are rewritten at the flow input/output
layer in this same phase; the old → new mapping is recorded in this
phase's PR/commit body so test coverage is not silently reduced.

## Acceptance Criteria

1. `src/engine/flows/` contains, at minimum, one `<command>.flow.ts` per
   migrated command (e.g., `dryrun.flow.ts`, `research.flow.ts`,
   `plan.flow.ts`, `retro-refine.flow.ts`, `retrospective.flow.ts`,
   `qa-workflow.flow.ts`, `directions.flow.ts`, `design.flow.ts`,
   `shape.flow.ts`, `spec.flow.ts`, `ingest.flow.ts`, `refine.flow.ts`,
   `rewind.flow.ts`). Each flow file exports a fascicle Step or composed
   flow that the corresponding `commands/<name>.ts` consumes.
2. Every migrated `commands/*.ts` entry point uses
   `makeRidgelineEngine(cfg)` and wraps `await run(flow, input, opts)` in
   a `try { ... } finally { await engine.dispose() }` block. The
   `dispose()` call runs on success, failure, AND SIGINT paths.
3. An ast-grep rule asserts: any file under `src/commands/` that imports
   fascicle's `run` MUST also call `dispose()` in a `finally` block in
   the same function. Adding a file that imports `run` without a sibling
   `finally`-block `dispose()` fails `npm run check`.
4. Snapshot test: `ridgeline --help` and every subcommand's `--help` is
   byte-equal to `.ridgeline/builds/fascicle-migration/baseline/help/<command>.txt`.
5. External signature snapshot: re-running `tsc --emitDeclarationOnly`
   over `src/commands/*.ts` produces `.d.ts` output byte-equal to
   `.ridgeline/builds/fascicle-migration/baseline/dts/`.
6. The CLI flag set is unchanged. A snapshot test of commander's parsed
   option set per command matches the Phase 1 baseline.
7. Every migrated command's existing E2E tests under `vitest.e2e.config.ts`
   pass without modification.
8. Tests targeting deleted internals are rewritten at the flow input/output
   layer in this phase. The phase's commit body (or accompanying PR
   description) records the old test path → new test path mapping so
   coverage is auditable.
9. `.ridgeline/builds/fascicle-migration/phase-8-plugin-surface-audit.md`
   exists and enumerates every plugin call site that depends on
   `invokeBuilder`, `invokePlanner`, `invokeReviewer`, `runPhase`,
   `invokeClaude`, `parseStreamLine`, `createStreamHandler`,
   `extractResult`, or `createDisplayCallbacks`. Each call site has a
   disposition (`updated | removed | n/a`). The audit covers all
   plugin consumers reachable from the project — including any
   first-party plugins under `src/plugins/`, declared plugin directories,
   and plugin-host integrations.
10. `src/main.ts` STILL contains its manual `process.on('SIGINT', ...)`
    handler at this phase's exit (Phase 9 removes it).
11. `build` and `auto` commands are NOT migrated in this phase — they
    remain on the old pipeline until Phase 9.
12. `npm run check` exits with zero status.
13. `ridgeline build` (still on the old pipeline) runs end-to-end. Every
    migrated command runs end-to-end.
14. `.ridgeline/builds/fascicle-migration/phase-8-check.json` exists and
    is a verbatim copy of `.check/summary.json` at this phase's exit
    commit.

## Spec Reference

From `spec.md`, "Phase 5 — Leaf command flows":
> Migrate every leaf command (every src/commands/<name>.ts except `build`
> and `auto`) to construct a fascicle flow and call
> `run(flow, input, opts)` inside a try/finally that disposes the Engine.
> External command signatures (the function exported from each
> commands/<name>.ts and consumed by src/main.ts) and the CLI flag set are
> unchanged. The src/main.ts manual `process.on('SIGINT', ...)` is NOT yet
> removed in this phase — it covers any commands still on the old surface.

From `constraints.md`, "API Style":
> Command entry-point shape:
> ```ts
> const engine = makeRidgelineEngine(cfg);
> try {
>   await run(flow, input, { trajectory, checkpoint_store, install_signal_handlers: true });
> } finally {
>   await engine.dispose();
> }
> ```
