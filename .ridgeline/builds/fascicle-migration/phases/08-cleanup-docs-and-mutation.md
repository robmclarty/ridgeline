# Phase 8: Cleanup, Deletions, Docs, and Mutation Testing

## Goal

Delete the now-orphaned legacy substrate. Remove `src/engine/pipeline/` in its entirety; delete the five `src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}.ts` files; prune `src/engine/index.ts` down to the new `flow + atom + composite + adapter + makeRidgelineEngine` surface. Update every plugin call site enumerated in Phase 6's plugin-surface audit in this same PR — the audit's per-site disposition (`updated | removed | n/a`) is the worklist.

Replace ridgeline's regex-based `FATAL_PATTERNS` and `classifyError` with `instanceof` checks against fascicle's typed error classes. The retry policy `on_error` returns `true` exactly for `rate_limit_error`, `provider_error` (when status ∈ 5xx or network), and `on_chunk_error`; returns `false` for `aborted_error`, `engine_config_error`, `model_not_found_error`, `schema_validation_error`, `tool_approval_denied_error`, `provider_capability_error`, `provider_not_configured_error`, `tool_error`. `aborted_error` always short-circuits all retry layers and propagates cancellation. User-facing error messages for auth, schema-validation, and budget-exceeded paths match Phase 1 fixtures byte-for-byte.

Update `docs/architecture.md`, `docs/build-lifecycle.md`, `docs/ensemble-flows.md`, `docs/extending-ridgeline.md`, and `docs/long-horizon.md` so each describes the shell+core layering and references fascicle by name. Finalize the CHANGELOG entry with the list of removed exports. Run scoped Stryker mutation testing over `src/engine/{flows,atoms,composites,adapters}/**/*.ts`; the mutation score must be ≥ the Phase 1 baseline recorded for `src/engine/pipeline/`.

Verify all twelve §7 invariants are covered by named automated tests via the `invariants.md` checklist; record a simplicity-outcome summary (count of removed exports, deleted files, LOC delta on the legacy pipeline directory) so the migration's value is checkable rather than asserted.

## Context

Phases 6 and 7 migrated every command to fascicle. The legacy substrate (`src/engine/pipeline/` and the deleted-claude/* files) compiled and was importable but no command path called into it. This phase is the convergence point: deletions can only happen after every consumer has been audited (Phase 6) and every migration target is operational (Phase 7).

Bundling deletions, plugin updates, error refactor, docs, mutation testing, and the invariants checklist into one phase keeps the high-risk irreversible work atomic. At no intermediate commit does the codebase have a half-deleted pipeline directory or stale plugin call site. The Stryker run is intentionally last because it requires the new scope's full test coverage to be in place; running it earlier would produce misleading scores. The twelve-invariant checklist is pinned here to make exit verification mechanical rather than judgmental.

## Acceptance Criteria

1. `src/engine/pipeline/` directory does not exist on disk.
2. `src/engine/claude/claude.exec.ts`, `src/engine/claude/stream.parse.ts`, `src/engine/claude/stream.result.ts`, `src/engine/claude/stream.display.ts`, `src/engine/claude/stream.types.ts` do not exist on disk.
3. Across `src/`, `grep` for each of these symbols returns zero matches: `invokeBuilder`, `invokePlanner`, `invokeReviewer`, `runPhase`, `invokeClaude`, `parseStreamLine`, `createStreamHandler`, `extractResult`, `createDisplayCallbacks`, `FATAL_PATTERNS`, `classifyError`.
4. Across `src/`, `grep` for `src/engine/pipeline` and for the basenames `build.exec`, `phase.sequence`, `phase.graph`, `worktree.parallel`, `pipeline.shared` returns zero matches.
5. `src/engine/index.ts` re-exports `makeRidgelineEngine` and at least one symbol from each of `atoms/`, `composites/`, `adapters/`, `flows/`. Re-exports use camelCase ridgeline-side names; ast-grep rule passes: no `export ... as <camelCaseName>` re-exports of fascicle-snake_case symbols.
6. Affected plugin call sites enumerated in `phase-5-plugin-surface-audit.md` are updated in this PR. For each row in the audit: `disposition: updated` rows have a corresponding code change; `disposition: removed` rows have the removal in this PR; `disposition: n/a` rows are confirmed unchanged. If any plugin relied on a now-deleted symbol with no equivalent, a thin `StreamChunk` reader replacement is provided OR the breakage is documented in `CHANGELOG.md` as a plugin-author-facing change.
7. Retry policy uses fascicle's `retry({ on_error })`. Unit test constructs each error class and calls `on_error`, asserting it returns `true` exactly for `rate_limit_error`, `provider_error` (status ∈ 5xx or network), and `on_chunk_error`; and `false` for `aborted_error`, `engine_config_error`, `model_not_found_error`, `schema_validation_error`, `tool_approval_denied_error`, `provider_capability_error`, `provider_not_configured_error`, `tool_error`.
8. Unit test asserts `aborted_error` always returns `false` from `on_error` regardless of any wrapping retry policy. The test composes `retry(retry(retry(...)))` and confirms the abort propagates without retries.
9. Snapshot test for user-facing error messages: auth failure, schema-validation failure, budget-exceeded paths each emit a stderr message that is byte-equal to the corresponding entry in `.ridgeline/builds/fascicle-migration/baseline/fixtures/error-shapes.json` (modulo timestamps, build-paths, and run-IDs which are normalized).
10. Stryker config's `mutate` glob covers exactly `src/engine/{flows,atoms,composites,adapters}/**/*.ts` (verified by reading `stryker.conf.js` or equivalent).
11. Stryker run at this phase exit produces a mutation score ≥ the score recorded in `.ridgeline/builds/fascicle-migration/baseline/mutation-score.json`. The new score is appended to a `phase-7-mutation-score.json` artifact under `.ridgeline/builds/fascicle-migration/`.
12. Each of the five composites (`phase`, `graph_drain`, `worktree_isolated`, `diff_review`, `cost_capped`) has at least four `test()`/`it()` calls in its test file (verified by counting in `src/engine/composites/__tests__/`).
13. Each of the ten atoms has at least one unit test under `src/engine/atoms/__tests__/<atom>.test.ts`.
14. `docs/architecture.md`, `docs/build-lifecycle.md`, `docs/ensemble-flows.md`, `docs/extending-ridgeline.md`, and `docs/long-horizon.md` each contain the literal phrase `fascicle` at least once and describe the shell+core layering (ridgeline shell, fascicle core).
15. `docs/extending-ridgeline.md` contains a section heading matching `/atom|composite|flow|adapter/i` (case-insensitive) and a code example calling `makeRidgelineEngine`.
16. `docs/build-lifecycle.md` describes the two-tier resume model: outer cross-process resume (`state.json` + git tags, owned by `stores/state.ts`) vs intra-run per-step memoization (fascicle `CheckpointStore` under `.ridgeline/builds/<name>/state/<step-id>.json`) — explicitly stating they never overlap.
17. `docs/long-horizon.md` describes the trajectory-translation decision (fascicle `TrajectoryEvent` → ridgeline on-disk shape).
18. `CHANGELOG.md` entry under the new minor version contains: the three required bullets seeded in Phase 1 (Node 24 bump prominently called out, internal substrate migration, public CLI behavior unchanged); a list of removed exports (`invokeBuilder`, `invokePlanner`, `invokeReviewer`, `runPhase`, `invokeClaude`, `parseStreamLine`, `createStreamHandler`, `extractResult`, `createDisplayCallbacks`, `FATAL_PATTERNS`, `classifyError`); the disposition of `sandbox.ts` and `sandbox.types.ts` (reduced to detection helpers and config types).
19. `markdownlint-cli2` and `cspell` pass on all updated docs.
20. `.ridgeline/builds/fascicle-migration/invariants.md` is the final checklist mapping each of the twelve §7 invariants to its test file and test name. Every row references an existing test that is currently passing — verified by running each named test.
21. **Twelve-invariant regression suite passes end-to-end:**
    - **Invariant 1** — Visible behavior unchanged: CLI `--help` byte-equality test passes against Phase 1 baseline.
    - **Invariant 2** — File-format stability: `state.json` fixture loads and resumes; `phases/<id>.md` is byte-equivalent for a fixture prompt; `trajectory.jsonl` existing event types are byte-stable; `budget.json` totals match within 1e-9 USD.
    - **Invariant 3** — Exit code preservation: all non-zero exit codes match Phase 1 baseline including 130 on SIGINT.
    - **Invariant 4** — Worktree merge order: regression test stalls higher-index phases and asserts merge happens in phase-index order regardless of completion order.
    - **Invariant 5** — SIGINT semantics: post-Phase-7 only fascicle's handler is active; no double cleanup; worktrees and Claude subprocesses torn down once.
    - **Invariant 6** — Cross-process resume: `state.json` + tag-based outer resume continues to work; `CheckpointStore` is per-step intra-run only.
    - **Invariant 7** — Sandbox enforcement parity: pre-existing greywall integration tests pass unchanged.
    - **Invariant 8** — Prompt-cache hit rate preserved: `stable.prompt.ts` output is byte-stable for a frozen `ModelCallInput` fixture.
    - **Invariant 9** — Sandbox allowlist not widened: PR diff and snapshot test confirm no new entries in default `network_allowlist` or `additional_write_paths`.
    - **Invariant 10** — Adversarial round-cap error shape: error `.name` and `.message` match Phase 1 fixture for `maxRetries+1` exhaustion.
    - **Invariant 11** — Budget cap aborts before exceeding: cumulative ledger matches legacy; race semantics (at most one in-flight step exceeds) are documented and tested.
    - **Invariant 12** — `npm run check` green at every phase exit: per-phase `phase-<N>-check.json` snapshots under `.ridgeline/builds/fascicle-migration/` show zero failures across types, lint, struct, agents, dead code, docs, spell, tests; `ridgeline build` operational at every phase exit.
22. Terminal output golden-file snapshot suite passes: stdout/stderr captures for {successful build, SIGINT mid-build, adversarial retry, budget-exceeded abort, schema-validation failure} are byte-equal to Phase 1 baseline (normalized for timestamps, run-IDs, build-paths, ANSI cursor-position resets).
23. Ast-grep rule passes: zero `console.*`, zero `process.stderr/stdout.write` calls in `src/engine/{flows,atoms,composites,adapters}/`. New diagnostic events go through `ctx.trajectory.emit(...)`.
24. Ast-grep rule passes: zero emoji literals, zero new ANSI escape sequences in `src/engine/{flows,atoms,composites,adapters}/`.
25. Ast-grep rule passes: zero `export ... as <camelCaseName>` re-exports of fascicle-snake_case symbols anywhere in `src/`.
26. Ast-grep rule passes: fascicle's `create_engine` is imported only by `src/engine/engine.factory.ts`.
27. Simplicity-outcome summary recorded in `.ridgeline/builds/fascicle-migration/simplicity-outcome.md`: count of removed exports (≥ 9 from the deleted-symbol list); count of deleted files (≥ 6: pipeline contents + 5 claude/* files); LOC delta on `src/engine/pipeline/` (the directory is gone, so this is `-N` where `N` is the pre-migration LOC); LOC delta on `src/engine/claude/{claude.exec,stream.*}.ts`. Numbers are computed from `git log --shortstat` against the Phase 1 commit and recorded with the commit refs.
28. `npm run check` is green.
29. `ridgeline build --auto` against `.ridgeline/builds/fascicle-migration/` continues to complete end-to-end (final dogfood smoke).
30. `.ridgeline/builds/fascicle-migration/phase-7-check.json` captures a green `.check/summary.json` snapshot at the phase-exit commit.
31. The phase exit commit subject begins with `phase-7:`.

## Spec Reference

- spec.md → "Phase 7 — Cleanup, deletions, docs, and mutation testing": deletions, public-surface pruning, plugin call site updates, error refactor (`FATAL_PATTERNS`/`classifyError` → `instanceof` against fascicle errors), Stryker mutation testing scope and floor, docs updates, CHANGELOG finalization.
- spec.md → "Twelve invariants — automated regression tests": every invariant verified by a named test, mapped in `invariants.md`.
- spec.md → "Test coverage and mutation testing scope": Stryker `mutate` glob; mutation score ≥ Phase 1 baseline; ≥ 4 unit tests per composite; ≥ 1 unit test per atom.
- spec.md → "Terminal output and artifact format preservation": golden-file snapshot suite assertions.
- spec.md → "Naming-convention boundary visibility": no alias re-exports of fascicle-snake_case symbols.
- constraints.md → "Error Handling": retry policy `on_error` rules; `aborted_error` short-circuits all retry layers.
- taste.md → "Code Style": no backwards-compat shims, deprecated re-exports, or `// removed` markers — delete cleanly.
