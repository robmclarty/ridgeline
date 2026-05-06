---
depends_on: [10-mutation-tests]
---

# Phase 11: Cleanup, deletions, error class replacement, retry policies

## Goal

Delete the now-dead pre-migration substrate in a single coordinated phase:

1. Delete `src/engine/pipeline/` in its entirety.
2. Delete
   `src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}.ts`.
3. Prune `src/engine/index.ts` of every removed public export
   (`invokeBuilder`, `invokePlanner`, `invokeReviewer`, `runPhase`,
   `invokeClaude`, `parseStreamLine`, `createStreamHandler`,
   `extractResult`, `createDisplayCallbacks`); add re-exports of
   `makeRidgelineEngine` and at least one symbol from each of `atoms/`,
   `composites/`, `adapters/`, `flows/`.
4. Update every plugin call site enumerated in
   `phase-8-plugin-surface-audit.md`. If a plugin relied on a now-deleted
   symbol with no equivalent, provide a thin StreamChunk-reader replacement
   OR document the breakage in `CHANGELOG.md` as a plugin-author-facing
   change.
5. Replace ridgeline's regex-based `FATAL_PATTERNS` and `classifyError`
   with `instanceof` checks against fascicle's typed error classes.
6. Configure retry policies via fascicle's `retry({ on_error })` with the
   error-class allowlist documented in spec.md and constraints.md.

By phase exit, grep across `src/` returns zero matches for any of the
removed symbols, the pipeline path, or the basenames of the deleted stream
files. User-facing error messages for auth, schema-validation, and
budget-exceeded paths match the Phase 1 error-shape baseline byte-for-byte.

## Context

This phase is the load-bearing demolition. Order matters: prune the public
surface first (Step 3) so any straggler imports break visibly, then update
plugin call sites (Step 4), then delete the source files (Steps 1 and 2).
The error-class and retry-policy work (Steps 5 and 6) can run in parallel
with the deletion sequence — they touch different files.

The mutation-score gate has already passed (Phase 10), so deletion does
not regress the test corpus's protective coverage on the new layer.

## Acceptance Criteria

1. `src/engine/pipeline/` does not exist on disk (verified by `ls`).
2. `src/engine/claude/claude.exec.ts`, `stream.parse.ts`,
   `stream.result.ts`, `stream.display.ts`, and `stream.types.ts` do not
   exist on disk.
3. After this phase, `grep` across `src/` returns zero matches for each
   of: `invokeBuilder`, `invokePlanner`, `invokeReviewer`, `runPhase`,
   `invokeClaude`, `parseStreamLine`, `createStreamHandler`,
   `extractResult`, `createDisplayCallbacks`, `FATAL_PATTERNS`,
   `classifyError`.
4. After this phase, `grep` across `src/` returns zero matches for the
   path `src/engine/pipeline` and for the basenames `build.exec`,
   `phase.sequence`, `phase.graph`, `worktree.parallel`, `pipeline.shared`.
5. `src/engine/index.ts` re-exports `makeRidgelineEngine` and at least one
   symbol from each of: `src/engine/atoms/`, `src/engine/composites/`,
   `src/engine/adapters/`, `src/engine/flows/`. The deleted export names
   are absent from the file.
6. Every plugin call site enumerated in
   `.ridgeline/builds/fascicle-migration/phase-8-plugin-surface-audit.md`
   with disposition `updated` is updated in this phase; sites with
   disposition `removed` are deleted; sites with disposition `n/a` need
   no change. If any plugin consumer cannot be migrated without a
   replacement, a thin StreamChunk-reader replacement is provided in
   `src/engine/` (or wherever the project's convention dictates) AND the
   `CHANGELOG.md` migration entry lists the plugin-author-facing change
   under a "Breaking for plugin authors" sub-bullet.
7. Retry policies under `src/engine/{flows,atoms,composites,adapters}/`
   use fascicle's `retry({ on_error })`. The `on_error` callback returns
   `true` (retry) for: `rate_limit_error`, `provider_error` when status
   is in 5xx or `network`, and `on_chunk_error`. It returns `false`
   (abort) for: `aborted_error`, `engine_config_error`,
   `model_not_found_error`, `schema_validation_error`,
   `tool_approval_denied_error`, `provider_capability_error`,
   `provider_not_configured_error`, and `tool_error`. A unit test
   constructs each error class and asserts the `on_error` return value.
8. A unit test asserts `aborted_error` always returns `false` from
   `on_error` regardless of any wrapping retry policy: it short-circuits
   all retry layers and propagates cancellation.
9. User-facing error messages for auth, schema-validation, and
   budget-exceeded paths match the snapshots in
   `.ridgeline/builds/fascicle-migration/baseline/fixtures/error-shapes.json`.
   A snapshot test asserts byte equality of `error.name` and
   `error.message` for each path.
10. The adversarial round-cap exhaustion error continues to match the
    Phase 1 fixture for `maxRetries + 1` exhaustion (already covered by
    the Phase 5 composite test; this phase verifies the assertion still
    passes after deletions).
11. `npm run check` exits with zero status. Every test in the project
    passes after the deletions and the public-surface prune.
12. `ridgeline build` runs end-to-end through the new substrate. No
    command path imports any deleted symbol.
13. `.ridgeline/builds/fascicle-migration/phase-11-check.json` exists and
    is a verbatim copy of `.check/summary.json` at this phase's exit
    commit.

## Spec Reference

From `spec.md`, "Phase 7 — Cleanup, deletions, docs, and mutation testing":
> Delete src/engine/pipeline/ in its entirety. Delete
> src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}.ts.
> Prune src/engine/index.ts public surface (invokeBuilder, invokePlanner,
> invokeReviewer, runPhase, invokeClaude, parseStreamLine,
> createStreamHandler, extractResult, createDisplayCallbacks); export the
> new flow + atom + composite + adapter + makeRidgelineEngine surface.
> Update affected plugin call sites in the same PR. Replace ridgeline's
> regex-based FATAL_PATTERNS / classifyError with instanceof checks
> against fascicle's typed errors.

From `constraints.md`, "Error Handling":
> `on_error` returns `true` (retry) for: `rate_limit_error`,
> `provider_error` when status ∈ 5xx or network, `on_chunk_error`.
> `on_error` returns `false` (abort) for: `aborted_error`,
> `engine_config_error`, `model_not_found_error`,
> `schema_validation_error`, `tool_approval_denied_error`,
> `provider_capability_error`, `provider_not_configured_error`,
> `tool_error`. `aborted_error` always short-circuits all retry layers
> and propagates cancellation.
