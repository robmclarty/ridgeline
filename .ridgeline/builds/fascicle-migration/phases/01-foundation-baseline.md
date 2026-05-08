# Phase 1: Foundation and baseline corpus

## Goal

Establish the foundation for the substrate swap: add fascicle (0.3.x) and zod
(4.x) as exact-pinned runtime dependencies, bump the Node engine to `>=24`,
drop Node 20 from CI, scaffold the new directory tree under `src/engine/`, and
finalize the baseline corpus that every later phase asserts against (CLI
`--help` snapshots, `.d.ts` signatures, fixture recordings of state.json /
trajectory.jsonl / budget.json / phases/, error-shape snapshots, claude_cli
capability matrix, and pre-migration mutation-score baseline).

The baseline corpus is the regression net for the entire migration. By the
end of this phase a CHANGELOG entry exists under the next minor version with
the BREAKING-FOR-CONSUMERS Node-24 callout prominent, and the project still
builds and runs end-to-end on the old pipeline. Nothing fascicle-driven is
wired up yet — this phase only prepares the terrain.

## Context

Brownfield. Most baseline artifacts already exist under
`.ridgeline/builds/fascicle-migration/baseline/` (help/, dts/,
fixtures/, capability-matrix.md, mutation-score.json, sandbox-allowlist
snapshots, exit-codes.md, greywall-tests.txt). The job in this phase is to
verify they are complete and correct against the spec's requirements, fill
any gaps, and lock the scaffold + dependency state in a single phase-exit
commit.

The new directory tree is empty source files only — no fascicle code is
written here. Old `src/engine/pipeline/` and `src/engine/claude/{claude.exec,
stream.*}.ts` remain operational and unmodified.

## Required Tools

A separately installed stable ridgeline binary is required for any
re-recording of the trajectory.jsonl / state.json / budget.json / phases
fixture set if existing baseline fixtures are missing or stale. The binary
under migration must never be invoked to refresh its own baseline — record
fixtures only via the stable binary operating against a worktree of `main`.

## Acceptance Criteria

1. `package.json` `dependencies` includes `fascicle` resolving to a 0.3.x
   version and `zod` resolving to a 4.x version. Both are exact-pinned (no
   `^` or `~` prefix) per the project's `.npmrc save-exact=true` convention.
2. `package.json` does NOT include `@ai-sdk/anthropic` or `ai` in
   `dependencies`, `devDependencies`, or `peerDependencies`.
3. `package.json` `engines.node` is `>=24`.
4. Every CI workflow file under `.github/workflows/` contains zero matches
   for `node-version: 20`, `node: 20`, `node-version: '20'`, or
   `node-version: "20"`. Only Node 24 (or 24+) is exercised.
5. `src/engine/flows/`, `src/engine/atoms/`, `src/engine/composites/`, and
   `src/engine/adapters/` exist; each contains an `index.ts` whose body is
   empty (no re-exports yet). `src/engine/pipeline/` and
   `src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}.ts`
   remain on disk unchanged.
6. The baseline corpus under `.ridgeline/builds/fascicle-migration/baseline/`
   includes:
   - `help/<command>.txt` for `ridgeline --help` and every subcommand's
     `--help`.
   - `dts/` containing `tsc --emitDeclarationOnly` output for every
     `src/commands/*.ts`.
   - `fixtures/trajectory.jsonl`, `fixtures/state.json`,
     `fixtures/budget.json`, and `fixtures/phases/` recorded from a
     pre-migration build.
   - `fixtures/error-shapes.json` with `{ name, message }` for at minimum:
     adversarial round-cap exhaustion, schema-validation failure, auth
     failure, and budget-exceeded paths.
   - `mutation-score.json` recording the Stryker score on
     `src/engine/pipeline/`. If the active sandbox blocks Stryker, the file
     records `{ "score": null, "captured": false }` plus an unblock-recipe
     line referencing `RIDGELINE_SANDBOX=0` or `vitest pool: 'forks'` for
     `coverageAnalysis: 'perTest'`.
   - `capability-matrix.md` listing the verified fascicle version and its
     `claude_cli` provider capability surface (sandbox kinds, auth modes,
     streaming events, cost reporting, AbortSignal propagation, model alias
     set, `startup_timeout_ms`, `stall_timeout_ms`, `skip_probe`).
   - `sandbox-allowlist.semi-locked.json` and
     `sandbox-allowlist.strict.json` snapshots derived from the
     pre-migration `sandbox.greywall.ts` allowlist.
   - `exit-codes.md` enumerating every non-zero exit code the pre-migration
     CLI emits and the trigger for each.
   - `greywall-tests.txt` listing the full set of greywall integration test
     names (used by Phase 2 to assert all pre-existing tests pass unchanged).
7. `CHANGELOG.md` contains a new entry under the next minor version (after
   `0.11.2`). The entry's first bullet — placed at the top of the entry —
   prominently calls out the `engines.node` bump from `>=20` to `>=24` as
   BREAKING for consumers. The entry contains at least three bullets total:
   (a) Node 24 BREAKING callout, (b) internal substrate migration to
   fascicle, (c) public CLI behavior unchanged.
8. Running `npm run check` exits with zero status. Per-tool output exists
   under `.check/` and `.check/summary.json` shows zero failures across
   types, lint, struct, agents, dead code, docs, spell, tests.
9. Running `ridgeline build` against
   `.ridgeline/builds/fascicle-migration/` completes end-to-end on the old
   pipeline (this phase has not yet wired any fascicle code).
10. `.ridgeline/builds/fascicle-migration/phase-1-check.json` exists and is
    a verbatim copy of `.check/summary.json` at this phase's exit commit.

## Spec Reference

From `spec.md`, "Phase 0 — Scaffold, dependencies, and baseline capture":
> Add fascicle (0.3.x) and zod (4.x — major version dictated by fascicle's
> peer-dependency) as runtime dependencies, bump engines.node from `>=20` to
> `>=24`, drop Node 20 from the CI matrix, create the new directory tree
> under src/engine/ (flows/, atoms/, composites/, adapters/) with empty
> index.ts files, and capture every pre-migration baseline that later phases
> verify against.

From `constraints.md`, "Phase Discipline":
> Each phase's exit commit must have: (a) `npm run check` green; (b)
> `ridgeline build` operational against this build's
> `.ridgeline/builds/fascicle-migration/` directory; (c)
> `.ridgeline/builds/fascicle-migration/phase-<N>-check.json` artifact
> captured (the `.check/summary.json` snapshot at that commit).
