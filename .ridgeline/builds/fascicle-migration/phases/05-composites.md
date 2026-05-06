---
depends_on: [01-foundation-baseline]
---

# Phase 5: Tier 1 composites

## Goal

Implement exactly five Tier 1 composites in `src/engine/composites/`, each
conforming to fascicle's `Step<i, o>` contract: `phase`, `graph_drain`,
`worktree_isolated`, `diff_review`, and `cost_capped`. Each composite
propagates `AbortSignal` from `ctx.signal` to its inner Step within
100 ms, emits at least one trajectory event named via `describe('<name>')`,
registers cleanup via `ctx.on_cleanup(...)` that runs on success / failure /
abort paths, and surfaces a typed error class on failure paths.

By phase exit each composite has at least four unit tests covering abort
propagation, trajectory event emission, cleanup registration, and error
surfacing. `graph_drain` and `cost_capped` are tagged with a single-line
top-of-file deferral-rationale comment marking them as upstream-RFC
candidates pending production exposure (they stay ridgeline-side this
migration). `phase` exposes either an `archive_feedback` slot OR composes
`adversarial_archived` — never both.

## Context

This phase runs in parallel with Phases 2, 3, and 4 — composites are pure
Step wrappers that depend only on fascicle's `Step` and `RunContext`
interfaces (in scope from Phase 1's dependency add) and do not import from
the engine factory, the sandbox policy, or the adapters. Composites are
consumed later by command flows in Phases 8 and 9.

No Tier 2 composites land in this phase. The Tier 2 audit (with_stable_prompt,
with_handoff, specialist_panel, adversarial_archived, resumable) happens
later, in Phase 7 atoms-b, and the default outcome is no Tier 2 composites
unless 3+ call-site repetitions are demonstrated.

`worktree_isolated`'s `merge_back` parameter defaults to `'index_order'`,
meaning even if phase index `[2, 0, 1]` complete in the order
`[1, 2, 0]`, the merge happens in `[0, 1, 2]` — completion order is
intentionally ignored. The accompanying regression test stalls higher-index
phases to prove the merge order is independent of completion order.

`cost_capped`'s race semantics are documented in a single-line top-of-file
comment: cumulative budget can be exceeded by at most one in-flight step
because the abort signal is raised on the cumulative cost boundary, but a
step already in flight at that moment is allowed to complete. Test
assertions reflect this.

## Acceptance Criteria

1. `src/engine/composites/` contains exactly: `phase.ts`, `graph_drain.ts`,
   `worktree_isolated.ts`, `diff_review.ts`, `cost_capped.ts`, and
   `index.ts` (a barrel re-exporting each composite). No other source
   files are introduced under `src/engine/composites/` in this phase.
2. Each composite is exported as a function returning a fascicle `Step`
   instance; each Step is decorated via `describe('<name>')` so trajectory
   events carry the composite's name as the source.
3. For each of the five composites there exist at least four `it(...)` /
   `test(...)` blocks under `src/engine/composites/__tests__/<name>.test.ts`
   covering, at minimum:
   - (a) Abort propagation: when the outer `ctx.signal` is aborted, the
     inner Step receives an abort within 100 ms.
   - (b) Trajectory event emission: at least one trajectory event with the
     composite name as source is emitted during a successful run.
   - (c) Cleanup registration: a handler registered via
     `ctx.on_cleanup(...)` runs on success, runs on failure, AND runs on
     abort. (One test may exercise all three exit paths or three separate
     tests may exercise each — either is acceptable.)
   - (d) Error surfacing: on the failure path, the expected fascicle error
     class is thrown with a stable `.name` and `.message`.
4. `phase.ts`'s test suite asserts that exhausting `maxRetries + 1`
   unsuccessful rounds throws an error whose `.name` and `.message` match
   the snapshot at
   `.ridgeline/builds/fascicle-migration/baseline/fixtures/error-shapes.json`
   under the adversarial round-cap exhaustion key.
5. `phase.ts` exposes either an `archive_feedback` slot OR composes
   `adversarial_archived` — not both. The chosen design is documented in a
   single-line top-of-file comment.
6. `graph_drain.ts` accepts a `concurrency: number` parameter. A unit test
   sets `concurrency: 2`, supplies 4 ready inner Steps that block on a
   shared signal, and asserts that no more than 2 inner Steps are in
   flight at any instant (verified by counting concurrent invocations of
   the inner stub).
7. `worktree_isolated.ts` defaults to `merge_back: 'index_order'`. A unit
   test supplies 3 inner phases with input indices `[2, 0, 1]`, all
   succeeding, and a stub git driver. Higher-index phases are deliberately
   stalled longer than lower-index phases. The merge order recorded by the
   stub is exactly `[0, 1, 2]` — proving completion order is ignored.
8. `cost_capped.ts` has a top-of-file single-line comment documenting the
   race semantics: "cumulative budget can be exceeded by at most one
   in-flight step". A unit test emits cumulative cost events
   `0.50, 0.95, 1.05` with `max_usd: 1.00` and asserts the inner Step
   receives an abort signal before the third event triggers a new
   `model_call`.
9. `diff_review.ts`'s test suite asserts the trajectory event sequence
   preserves the build → commit → diff → review ordering for a successful
   run.
10. `graph_drain.ts` and `cost_capped.ts` each have a single-line
    top-of-file comment marking them as upstream-RFC candidates pending
    production exposure (e.g., `// upstream-RFC candidate; ridgeline-side
    until production exposure proves the abstraction.`).
11. No composite imports from `src/engine/pipeline/` or from any of
    `src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}`.
    Verified by grep.
12. `npm run check` exits with zero status.
13. `ridgeline build` runs end-to-end on the old pipeline (composites are
    not yet consumed).
14. `.ridgeline/builds/fascicle-migration/phase-5-check.json` exists and is
    a verbatim copy of `.check/summary.json` at this phase's exit commit.

## Spec Reference

From `spec.md`, "Phase 3 — Tier 1 composites":
> Implement exactly five Tier 1 composites in src/engine/composites/, each
> conforming to fascicle's `Step<i,o>` contract with abort propagation,
> trajectory event emission, and `ctx.on_cleanup` registration. No Tier 2
> composites land in this phase.

From `taste.md`, "Code Style":
> Use the simplest fascicle primitive that fits at the boundary while
> preserving fascicle's full primitive surface internally. Only introduce a
> Tier 2 composite if Phase 4's audit shows 3+ call-site repetitions of
> the same imperative pattern; otherwise leave it imperative.
