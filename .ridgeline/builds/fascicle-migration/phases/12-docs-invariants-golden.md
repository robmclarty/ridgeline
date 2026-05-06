---
depends_on: [11-cleanup-deletions]
---

# Phase 12: Docs, invariants checklist, golden-file output suite, ast-grep finalization

## Goal

Land the documentation and verification artifacts that close out the
migration:

1. Update `docs/architecture.md`, `docs/build-lifecycle.md`,
   `docs/ensemble-flows.md`, `docs/extending-ridgeline.md`, and
   `docs/long-horizon.md` to describe the shell+core layering, the
   two-tier resume model, and the trajectory-translation decision. Each
   doc contains the literal phrase `fascicle` at least once.
2. Finalize `CHANGELOG.md` for the new minor version. The entry retains
   the three required Phase 1 bullets (Node 24 BREAKING, internal
   substrate migration to fascicle, public CLI behavior unchanged) and
   gains: a list of removed exports, the disposition of
   `sandbox.ts`/`sandbox.types.ts`, and (if applicable) the
   plugin-author-facing breakage from Phase 11.
3. Land `.ridgeline/builds/fascicle-migration/invariants.md` — the
   checklist mapping each of the twelve §7 invariants to its test file
   and test name.
4. Land the golden-file output snapshot suite under
   `vitest.e2e.config.ts`'s reach (or the conventional snapshot
   directory) capturing stdout/stderr for representative flows
   (successful build, mid-build SIGINT, adversarial retry,
   budget-exceeded abort, schema-validation failure) and asserting
   byte equality against Phase 1 baselines, normalized for timestamps,
   run-IDs, build-paths, and ANSI cursor-position resets.
5. Add the remaining ast-grep rules that enforce taste-level invariants:
   no `console.*` or `process.stderr/stdout.write` in
   `src/engine/{flows,atoms,composites,adapters}/`; no emoji literals
   or new ANSI escape sequences in those directories; no
   `export ... as <camelCaseName>` re-export of any fascicle-snake_case
   symbol; no atom imports from the now-deleted
   `src/engine/{pipeline,claude/claude.exec,claude/stream.*}` paths
   (the directories no longer exist, but the rules guard regression).

By phase exit, every §7 invariant maps to a passing test, every doc
references fascicle and the new layering, and the golden-file suite
guards every representative output path. This is the migration's final
phase — `npm run check` green, `ridgeline build` end-to-end, and
the dogfood-evidence trail complete.

## Context

This phase consumes the cleaned-up substrate from Phase 11. The
documentation must reflect the final code state — the `src/engine/`
public surface, the layering, the resume contract, the translation
decision — so it cannot be written before deletions complete.

The golden-file suite captures real runs of representative flows. Two
of those flows (successful build, mid-build SIGINT) require running
the migrated CLI end-to-end, which is why a separately installed stable
ridgeline binary is listed in Required Tools — the recordings are
captured by driving the migrated binary from the stable harness, never
the migrated binary against itself.

## Required Tools

A separately installed stable ridgeline binary is required for capturing
the golden-file output recordings of the successful-build and
mid-build-SIGINT flows. The stable binary issues `ridgeline build`
against a worktree of `main` and the resulting stdout/stderr streams are
captured to the golden-file fixtures. Adversarial retry, budget-exceeded
abort, and schema-validation failure flows can be triggered via test
fixtures and stub Engine inputs — the stable binary is not strictly
required for those, but its use is acceptable.

Standard tooling (`npm run check`, vitest, ast-grep, markdownlint, cspell)
is required for the in-tree assertions and rule additions.

## Acceptance Criteria

1. Each of `docs/architecture.md`, `docs/build-lifecycle.md`,
   `docs/ensemble-flows.md`, `docs/extending-ridgeline.md`, and
   `docs/long-horizon.md` contains the literal phrase `fascicle` at
   least once and describes the shell+core layering.
2. `docs/extending-ridgeline.md` contains a section heading matching the
   case-insensitive regex `/atom|composite|flow|adapter/` and a code
   example calling `makeRidgelineEngine`.
3. `docs/build-lifecycle.md` describes the two-tier resume model: outer
   cross-process resume (state.json + git tags, owned by
   `src/stores/state.ts`) versus intra-run per-step memoization
   (fascicle CheckpointStore under
   `.ridgeline/builds/<name>/state/<step-id>.json`) — explicitly stating
   they never overlap.
4. `docs/long-horizon.md` describes the trajectory-translation decision
   (fascicle event → ridgeline on-disk shape).
5. `markdownlint` and `cspell` (per `npm run check`'s docs and spell
   stages) pass on every updated doc.
6. `CHANGELOG.md`'s migration entry contains the three required Phase 1
   bullets (Node 24 BREAKING callout at the top, internal substrate
   migration to fascicle, public CLI behavior unchanged) plus: (a) a
   list of removed `src/engine/index.ts` exports; (b) the disposition
   of `sandbox.ts` and `sandbox.types.ts` (reduced to detection helpers
   and config types); (c) any plugin-author-facing breakage documented
   in Phase 11.
7. `.ridgeline/builds/fascicle-migration/invariants.md` exists and maps
   each of the twelve §7 invariants from `shape.md` to its test file
   and test name. Each entry has the form:
   `Invariant N — <name>: <relative-path-to-test-file>:<test-name>`.
   The twelve invariants covered are: visible behavior unchanged,
   file-format stability, exit-code preservation, worktree merge order,
   SIGINT semantics, cross-process resume, sandbox enforcement parity,
   prompt-cache hit-rate preserved, sandbox allowlist not widened,
   adversarial round-cap error shape, budget cap aborts before
   exceeding, `npm run check` green at every phase exit.
8. The golden-file output snapshot suite captures stdout AND stderr
   independently for at minimum these representative flows:
   - (a) Successful `ridgeline build`.
   - (b) `ridgeline build` interrupted by SIGINT mid-phase.
   - (c) Adversarial round-cap retry exhaustion path.
   - (d) Budget-exceeded abort path.
   - (e) Schema-validation failure path.
   Each snapshot is byte-equal to a Phase 1 baseline (or a freshly
   recorded baseline added in this phase to the
   `.ridgeline/builds/fascicle-migration/baseline/output-snapshots/`
   directory if Phase 1 did not record one), normalized for: timestamps,
   run-IDs, build-paths, and ANSI cursor-position resets. Non-semantic
   timing differences in stream chunking are tolerated; visible-character
   sequences must match.
9. Stderr versus stdout splitting is preserved: the snapshot suite
   captures both streams independently and the splitting rules match
   pre-migration (errors and fatal diagnostics on stderr; non-error
   progress and result output on stdout).
10. Non-TTY stdout output (piped, with `NO_COLOR` set, or with stdout
    not a TTY) preserves graceful degradation in the snapshot suite: no
    spinner frames, no color codes when `NO_COLOR` is set, no color
    codes when stdout is not a TTY; `FORCE_COLOR` continues to override.
11. ast-grep rules under the project's existing rule directory enforce:
    - (a) No `console.log`, `console.error`, `console.warn`, or
      `process.stderr.write`/`process.stdout.write` in
      `src/engine/{flows,atoms,composites,adapters}/`.
    - (b) No emoji literal in any source file under
      `src/engine/{flows,atoms,composites,adapters}/`.
    - (c) No new ANSI escape sequence introduction in
      `src/engine/{flows,atoms,composites,adapters}/` beyond the
      pre-existing palette in `src/ui/*` and the prior `stream.display.ts`.
    - (d) No `export ... as <camelCaseName>` re-export of any fascicle
      snake_case symbol (`create_engine`, `model_call`, `run`,
      `aborted_error`, `rate_limit_error`, etc.).
    - (e) No import from `src/engine/pipeline/` or from the deleted
      `src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}`
      paths anywhere in `src/`. (The directories no longer exist;
      these rules guard regression if the paths reappear.)
12. Adding a violation of any rule from criterion 11 fails
    `npm run check`.
13. New ridgeline-emitted trajectory event types added during the
    migration use camelCase. Fascicle-emitted event types retain
    snake_case as fascicle emits them. An ast-grep rule (or test)
    asserts this for any new event-type identifier introduced in
    `src/engine/{flows,atoms,composites,adapters}/`.
14. `npm run check` exits with zero status. Every test, including the
    new golden-file snapshot suite and the invariants tests, passes.
15. `ridgeline build` runs end-to-end through the substrate-swapped
    pipeline.
16. `.ridgeline/builds/fascicle-migration/phase-12-check.json` exists
    and is a verbatim copy of `.check/summary.json` at this phase's
    exit commit.

## Spec Reference

From `spec.md`, "Phase 7 — Cleanup, deletions, docs, and mutation testing":
> docs/architecture.md, docs/build-lifecycle.md, docs/ensemble-flows.md,
> docs/extending-ridgeline.md, and docs/long-horizon.md each contain the
> literal phrase `fascicle` at least once and describe the shell+core
> layering.
> docs/extending-ridgeline.md contains a section heading matching
> `/atom|composite|flow|adapter/i` and a code example calling
> `makeRidgelineEngine`.

From `spec.md`, "Twelve invariants — automated regression tests":
> Each of the twelve §7 invariants from shape.md is verified by at least
> one named automated test. Failures block phase merges. A checklist
> file `.ridgeline/builds/fascicle-migration/invariants.md` maps each
> invariant to its test file and test name.

From `spec.md`, "Terminal output and artifact format preservation":
> A golden-file snapshot suite captures stdout/stderr for representative
> flows (a successful `ridgeline build`, a SIGINT mid-build, an
> adversarial retry, a budget-exceeded abort, a schema-validation
> failure) and asserts equality against Phase 0 baselines, normalized
> for: timestamps, run-IDs, build-paths, and ANSI cursor-position
> resets.
