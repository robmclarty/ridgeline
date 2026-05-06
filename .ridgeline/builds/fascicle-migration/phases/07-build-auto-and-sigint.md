# Phase 7: Build Flow, Auto Flow, and SIGINT Handover

## Goal

Migrate the two highest-complexity orchestrations — `build` and `auto` — to fascicle flows that exercise every Tier 1 composite (`phase`, `graph_drain`, `worktree_isolated`, `diff_review`, `cost_capped`). Once every command runs through `run(flow, ...)`, remove the manual `process.on('SIGINT', ...)` handler in `src/cli.ts` and rely on fascicle's runner default `install_signal_handlers: true`. Migrate teardown to `ctx.on_cleanup(...)` registrations inside steps; no orphan claude subprocesses or worktrees should remain after a SIGINT.

The dogfood gate is a hard exit-criterion: `ridgeline build --auto` against this build's `.ridgeline/builds/fascicle-migration/` directory completes successfully end-to-end, dogfooding the migration. A separately installed stable ridgeline binary drives the run on a worktree of main; the binary under migration never executes itself. Trajectory excerpt, final `state.json` digest, and timestamp are recorded in `dogfood-evidence.md` as evidence.

SIGINT exit code 130 is preserved. Cross-process resume via `state.json` + git tags continues to span processes; the per-step `CheckpointStore` is intra-run only and does not interfere — verified by an explicit E2E test. A golden-file snapshot suite captures stdout/stderr for representative flows (successful build, SIGINT mid-build, adversarial retry, budget-exceeded abort, schema-validation failure) and asserts byte equality against Phase 1 baselines (normalized for timestamps, run-IDs, build-paths, and ANSI cursor-position resets).

## Context

Phase 6 migrated 13 leaf commands and landed the engine factory. This phase migrates the remaining two commands (`build`, `auto`), removes the manual SIGINT handler, and dogfoods the migration. After this phase, every command runs through fascicle's runner and the legacy SIGINT path is gone — but the legacy `src/engine/pipeline/` directory and the deleted-claude/* files still exist on disk (they go away in Phase 8).

Removing the manual SIGINT handler before every command is migrated would orphan unmigrated commands' cleanup. Doing it now is the first safe moment.

## Acceptance Criteria

1. `src/commands/build.ts` is a thin shell over `src/engine/flows/build.flow.ts`; `src/commands/auto.ts` is a thin shell over `src/engine/flows/auto.flow.ts`. Both use `makeRidgelineEngine(cfg)` and call `run(flow, input, opts)` in a `try/finally` with `engine.dispose()`.
2. `src/engine/flows/` contains at minimum: `build.flow.ts`, `auto.flow.ts`, plus the per-command flow files added in Phase 6.
3. `build.flow.ts` exercises every Tier 1 composite at least once: `phase`, `graph_drain`, `worktree_isolated`, `diff_review`, `cost_capped`. Verified by ast-grep rule asserting each composite's name appears in the file's import list, and by a flow-shape unit test that introspects the constructed flow's Step tree (or its `describe`-decorated trajectory event names) and asserts each composite name is present.
4. `auto.flow.ts` exercises the composites it needs (at minimum `phase` and `cost_capped`).
5. `src/cli.ts` contains zero matches for `process.on('SIGINT'` or `process.on("SIGINT"` (verified by grep).
6. Every `commands/*.ts` call to `run(...)` either passes `install_signal_handlers: true` explicitly OR omits the key and relies on fascicle's default. A unit test asserts fascicle's default for `install_signal_handlers` is `true` at the pinned fascicle version (loaded from the lockfile-recorded version, not a hardcoded literal).
7. E2E test `sigint-build.e2e.test.ts`: starts a `ridgeline build`, sends SIGINT after a configurable delay (default 5s into a phase execution), and asserts:
   - (a) process exit code === 130;
   - (b) any created git worktrees have been removed (verified by `git worktree list` returning a count equal to the pre-test count);
   - (c) no orphan claude subprocesses remain (verified by `ps -ef | grep claude` returning no matches whose parent PID is the dead ridgeline process);
   - (d) no "double cleanup" errors are logged (stderr scan for the substring `cleanup` paired with `error` returns zero matches);
   - (e) `engine.dispose()` was called on the SIGINT path (verified via a tracing hook or log assertion).
8. E2E test `sigint-mid-phase.e2e.test.ts`: SIGINT during a `phase` composite mid-round leaves the partial round's checkpoint files cleanly written (no half-written JSON), `trajectory.jsonl` is appended atomically (no torn lines), and `budget.json` totals reflect only completed events.
9. E2E test `cross-process-resume.e2e.test.ts`: starts a `ridgeline build`, sends SIGINT, restarts via the existing `state.json` + tag-based outer resume path, and asserts the build resumes from the next phase. Confirms the `CheckpointStore` is per-step intra-run only and does not interfere with cross-process resume (the resumed process's `CheckpointStore` starts empty for the new step).
10. E2E test `worktree-cleanup-on-failure.e2e.test.ts`: forces a phase to fail mid-run inside a `worktree_isolated` composite and asserts the worktree is removed by the registered `ctx.on_cleanup` handler.
11. **Dogfood gate**: `ridgeline build --auto` against `.ridgeline/builds/fascicle-migration/` completes successfully end-to-end. The run is performed by a separately installed stable ridgeline binary operating on a worktree of main; the binary under migration never executes itself.
12. `.ridgeline/builds/fascicle-migration/dogfood-evidence.md` records: a `trajectory.jsonl` excerpt covering the first phase's events; the final `state.json` content (digest + truncated content); the run timestamp; the stable-binary version that drove the run.
13. Golden-file snapshot suite captures stdout/stderr for representative flows — successful `ridgeline build`, SIGINT mid-build, adversarial retry, budget-exceeded abort, schema-validation failure — and asserts equality against `.ridgeline/builds/fascicle-migration/baseline/fixtures/` golden snapshots (added in this phase if not already present from Phase 1), normalized for timestamps, run-IDs, build-paths, and ANSI cursor-position resets. Non-semantic timing differences in stream chunking are tolerated; visible-character sequences must match.
14. Tool-use blocks, thinking blocks, and final result blocks in streamed output render with the same prefix, indentation, and separator lines as the Phase 1 baselines (verified by the golden-file suite).
15. Inline cost tallies surfaced during a run match pre-migration formatting (currency symbol, precision, alignment) byte-for-byte for a fixed run (verified by the golden-file suite).
16. Non-TTY stdout (piped output, CI environments) preserves graceful degradation: no spinner frames, no color codes when `NO_COLOR` is set, no color codes when stdout is not a TTY; `FORCE_COLOR` continues to override. Verified by snapshot tests that capture output under each environment configuration.
17. stderr vs stdout splitting is preserved: error messages go to stderr; non-error progress and result output go to stdout. Verified by snapshot tests that capture both streams independently.
18. All teardown logic that previously lived in ad hoc cleanup registries is migrated to `ctx.on_cleanup(...)` registrations inside steps. An ast-grep rule flags any new ad hoc teardown registry pattern in `src/engine/{flows,atoms,composites,adapters}/`.
19. Snapshot test for `ridgeline --help` and `ridgeline build --help` continues to pass (byte equal to baseline) — confirms the build-flow refactor did not leak through to user-facing help.
20. External signatures of `commands/build.ts` and `commands/auto.ts` exported functions match the Phase 1 dts baseline.
21. Ast-grep rule passes: zero `console.*`, zero `process.stdout.write` / `process.stderr.write`, zero emoji literals, zero new ANSI escape sequences in the new `build.flow.ts` and `auto.flow.ts` files.
22. `npm run check` is green.
23. `.ridgeline/builds/fascicle-migration/phase-6-check.json` captures a green `.check/summary.json` snapshot at the phase-exit commit.
24. The phase exit commit subject begins with `phase-6:`.

## Spec Reference

- spec.md → "Phase 6 — Build flow, auto flow, and SIGINT handover": thin command shells, manual SIGINT removal, fascicle `install_signal_handlers` default, `ctx.on_cleanup` for teardown, dogfood gate.
- spec.md → "Twelve invariants" — invariant 5 (SIGINT semantics: exit 130, no double cleanup, worktrees and subprocesses torn down once); invariant 6 (cross-process resume via `state.json` + tags continues to work, `CheckpointStore` intra-run only).
- spec.md → "Terminal output and artifact format preservation": golden-file snapshot suite, stream chunking, tool-use/thinking/result block rendering, NO_COLOR/FORCE_COLOR/non-TTY behavior, stderr vs stdout splitting.
- constraints.md → "API Style" command entry-point shape; "Phase Discipline" Phase 6 dogfood gate.
- taste.md → "Code Style": fold universal features into defaults rather than flags or commands — fascicle's `install_signal_handlers: true` default replaces the manual handler; `ctx.on_cleanup` replaces ad hoc teardown registries.
