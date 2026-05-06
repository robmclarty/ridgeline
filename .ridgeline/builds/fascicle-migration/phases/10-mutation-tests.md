---
depends_on: [09-build-auto-sigint-dogfood]
---

# Phase 10: Mutation testing scope and test-count audits

## Goal

Configure scoped Stryker mutation testing over
`src/engine/{flows,atoms,composites,adapters}/**/*.ts` and assert the new
scope's mutation score meets the Phase 1 baseline. Conduct two test-count
audits as a second-line quality gate: each Tier 1 composite has at least
four unit tests covering abort, trajectory, cleanup, and error surfacing;
each of the ten atoms has at least one unit test under
`src/engine/atoms/__tests__/<atom>.test.ts`.

This phase intentionally lands BEFORE the cleanup/deletions phase. The
Phase 1 baseline `mutation-score.json` may have recorded
`{ "score": null, "captured": false }` (greywall blocked Stryker's TCP-IPC
worker bootstrap with EPERM). When that is the case, this phase first
captures the absolute pre-migration score on `src/engine/pipeline/` —
which still exists at this point — outside the active sandbox, writes it
into the baseline file, and only then asserts the new-scope score is
≥ that captured number. Running mutation testing AFTER pipeline deletion
would make the baseline capture impossible.

## Context

Stryker's `mutate` glob configuration is updated in this phase to cover
exactly `src/engine/{flows,atoms,composites,adapters}/**/*.ts` — and ONLY
that scope. Earlier phases left Stryker's existing config in place; here it
is rescoped. The composite/atom test-count audits run as a separate
pass — they are not Stryker mutations but structural assertions on the
test corpus that Phases 5 through 7 produced.

The cleanup/deletions phase (Phase 11) deletes `src/engine/pipeline/`. After
that point the pre-migration pipeline directory no longer exists on disk,
making the Phase 1 baseline-capture fallback impossible. So the order is:
Phase 9 (build/auto migration complete) → Phase 10 (mutation, captures
fallback baseline if needed, asserts new-scope gate) → Phase 11
(deletions) → Phase 12 (docs/invariants/golden).

## Required Tools

Stryker mutation testing requires an environment that allows TCP-localhost
IPC. If the active sandbox blocks Stryker (the Phase 1 baseline recorded
this scenario), mutation runs in this phase MUST execute with one of:

- `RIDGELINE_SANDBOX=0` (run outside greywall enforcement).
- `vitest pool: 'forks'` configured for `coverageAnalysis: 'perTest'`,
  which routes Stryker's worker IPC through process-fork stdio rather than
  TCP-localhost.

The phase must document which path was chosen in the
`phase-10-check.json` accompanying notes (or in a sibling
`phase-10-stryker-environment.md`) so the resolution is reproducible.

A separately installed stable ridgeline binary is NOT required for this
phase — Stryker invokes the test runner directly.

## Acceptance Criteria

1. The Stryker configuration file (typically `stryker.config.json`,
   `stryker.config.cjs`, or `stryker.config.mjs`) defines a `mutate` glob
   covering exactly `src/engine/flows/**/*.ts`,
   `src/engine/atoms/**/*.ts`, `src/engine/composites/**/*.ts`, and
   `src/engine/adapters/**/*.ts` (and their corresponding `index.ts`
   barrels). No other source files are included; tests are not mutated.
2. If `.ridgeline/builds/fascicle-migration/baseline/mutation-score.json`
   records `{ "captured": false }`, this phase captures the absolute
   pre-migration Stryker mutation score on `src/engine/pipeline/`
   (running outside the sandbox or with the documented `pool: 'forks'`
   workaround) and writes a complete record back to the baseline file
   (`{ "score": <number>, "captured": true, "captured_at_phase": 10, "environment": "<chosen-path>" }`).
   If `captured: true` was already recorded in Phase 1, this step is
   skipped and the existing score is treated as the gate.
3. A new Stryker run produces a mutation score on the
   `src/engine/{flows,atoms,composites,adapters}/**/*.ts` scope. The
   recorded score is written to
   `.ridgeline/builds/fascicle-migration/phase-10-mutation-score.json`
   (`{ "score": <number>, "scope": "src/engine/{flows,atoms,composites,adapters}", "captured_at": "<iso-timestamp>" }`).
4. The new-scope mutation score is greater than or equal to the recorded
   pre-migration baseline score. A dedicated assertion (script, test, or
   CI step) compares the two numbers and fails the phase exit if the new
   score is lower.
5. Test-count audit (composites): for each of `phase.ts`, `graph_drain.ts`,
   `worktree_isolated.ts`, `diff_review.ts`, `cost_capped.ts`, the
   corresponding `src/engine/composites/__tests__/<name>.test.ts`
   contains at least four `it(...)` or `test(...)` blocks. The audit is
   automated (e.g., a small node script that ast-greps test files) and
   produces
   `.ridgeline/builds/fascicle-migration/phase-10-composite-test-counts.json`
   listing per-composite counts. Counts < 4 fail the phase exit.
6. Test-count audit (atoms): for each of the ten atoms, the corresponding
   `src/engine/atoms/__tests__/<atom>.test.ts` contains at least one
   `it(...)` or `test(...)` block. The audit produces
   `.ridgeline/builds/fascicle-migration/phase-10-atom-test-counts.json`.
   Counts < 1 fail the phase exit.
7. `npm run check` exits with zero status. Stryker mutation testing
   itself is NOT part of `npm run check` (per repo convention) but the
   phase exit gate explicitly invokes Stryker as documented above.
8. `ridgeline build` runs end-to-end (every command runs through
   `run(flow, ...)` after Phase 9; the pipeline directory still exists
   but is dead code).
9. `.ridgeline/builds/fascicle-migration/phase-10-check.json` exists and
   is a verbatim copy of `.check/summary.json` at this phase's exit commit.

## Spec Reference

From `spec.md`, "Phase 7 — Cleanup, deletions, docs, and mutation testing":
> Stryker mutation testing scoped via `mutate` glob to
> `src/engine/{flows,atoms,composites,adapters}/**/*.ts` runs at Phase 7
> exit (outside the sandbox if necessary). If the Phase 0 baseline
> `mutation-score.json` recorded `captured: false`, capture the absolute
> pre-migration score on src/engine/pipeline/ first, write it to the file,
> and assert the new-scope score is ≥ that number. Otherwise, assert
> directly against the recorded baseline.

From `spec.md`, "Test coverage and mutation testing scope":
> Each Tier 1 composite has ≥ 4 unit tests (abort, trajectory, cleanup,
> error surfacing). Each atom has ≥ 1 unit test using a stub Engine.
