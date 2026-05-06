# Phase 4: Tier 1 Composites

## Goal

Build the five Tier 1 composites that every ridgeline flow will compose against: `phase` (adversarial round-capped phase execution), `graph_drain` (concurrency-limited graph traversal), `worktree_isolated` (parallel phases merged in input-index order), `diff_review` (build → commit → diff → review ordering), and `cost_capped` (cumulative-cost-bounded execution).

Each composite conforms to fascicle's `Step<i,o>` contract, propagates `AbortSignal` raised on `ctx` to its inner Step within 100 ms, emits at least one trajectory event under the composite name (via `describe('<name>')`), and registers cleanup via `ctx.on_cleanup` that runs on success, failure, and abort paths. Behavior under abort, retry, concurrency, and cost-cap race conditions is exhaustively unit-tested before any flow consumes these composites in later phases.

`graph_drain` and `cost_capped` are tagged in code as upstream-RFC candidates pending production exposure; they remain ridgeline-side this migration. No Tier 2 composites land in this phase — that decision is deferred to Phase 5's audit.

## Context

Phases 2 and 3 landed the data-plane adapters and the sandbox policy builder. This phase adds the abstraction layer above fascicle primitives that flows will use. Composites are written, decorated with `describe('<name>')`, and unit-tested in isolation — no flow imports them yet, and the legacy pipeline still runs every command end-to-end at phase exit.

The unit-test methodology uses stub Steps (in-test counters, deliberately-stalled stubs, recording stubs) rather than real fascicle providers. This decouples composite testing from the engine factory (Phase 6) and from the atoms (Phase 5), so each layer can be developed and verified independently.

The `phase` composite makes a deliberate single-feature choice: it exposes either an `archive_feedback` slot OR composes `adversarial_archived` — not both. Picking one and rejecting the other prevents two near-duplicate decorators from drifting independently.

## Acceptance Criteria

1. `src/engine/composites/` contains exactly: `phase.ts`, `graph_drain.ts`, `worktree_isolated.ts`, `diff_review.ts`, `cost_capped.ts`, `index.ts`.
2. Each composite is exported as a function returning a `Step` and is decorated via `describe('<name>')` so trajectory events carry the composite name. An ast-grep rule asserts the presence of `describe('<composite-name>')` in each composite file; the rule fails `npm run check` if missing.
3. Each composite has unit tests under `src/engine/composites/__tests__/<name>.test.ts` covering at minimum these four cross-cutting concerns (one `test()`/`it()` per concern, plus composite-specific behavior tests):
   - (a) `AbortSignal` raised on the outer `ctx` propagates to the inner Step within 100 ms.
   - (b) At least one trajectory event with the composite's `describe(...)` name appears in the recorded `ctx.trajectory` output.
   - (c) A registered `ctx.on_cleanup` handler runs on the success path.
   - (d) A registered `ctx.on_cleanup` handler runs on the failure path.
   - (e) A registered `ctx.on_cleanup` handler runs on the abort path.
   - (f) The expected error class and `.message` surfaces on the failure path.
4. Each composite has at least 4 distinct `test()`/`it()` calls in its test file (verified by counting).
5. **`phase.ts`** test asserts that exhausting `maxRetries+1` unsuccessful rounds throws an error whose `.name` and `.message` match the snapshot in `.ridgeline/builds/fascicle-migration/baseline/fixtures/error-shapes.json` (specifically the adversarial round-cap exhaustion entry).
6. **`phase.ts`** exposes either an `archive_feedback` slot OR composes `adversarial_archived` — not both. The choice is documented in a top-of-file comment with a one-sentence rationale. Verified by ast-grep: the file contains exactly one of those two patterns, not both.
7. **`graph_drain.ts`** enforces a `concurrency: number` parameter; with `concurrency=2` and 4 ready nodes, no more than 2 inner Steps are concurrently active at any instant. Verified by a test that uses a stub Step incrementing/decrementing an in-test counter and asserting the high-water mark never exceeds 2.
8. **`graph_drain.ts`** test additionally covers: `concurrency=1` (serial behavior — high-water mark is 1); `concurrency >= node_count` (full parallelism — high-water mark equals node count).
9. **`graph_drain.ts`** has a top-of-file comment marking it as an upstream-RFC candidate pending production exposure.
10. **`worktree_isolated.ts`** defaults `merge_back='index_order'`. Test: 3 inner phases with input indices `[2, 0, 1]` running in parallel, where the stub git driver deliberately stalls higher-index phases (phase index 2 takes longer than 1, which takes longer than 0); the merge order recorded by the stub is exactly `[0, 1, 2]` regardless of completion order.
11. **`worktree_isolated.ts`** test additionally covers: failure of one inner phase aborts merge for that phase only (per documented semantics in a top-of-file comment); abort signal cleans up all created worktrees via the registered `ctx.on_cleanup` handler removing every parent worktree directory.
12. **`cost_capped.ts`**: emitting cumulative cost events `0.50, 0.95, 1.05` with `max_usd=1.00` results in the inner Step receiving an abort signal before the third event triggers a new `model_call`. The inner Step is a stub recording invocations; the test asserts at most 2 `model_call` invocations occurred. The race semantics (cumulative budget can be exceeded by at most one in-flight step) are documented in a top-of-file comment.
13. **`cost_capped.ts`** test additionally covers: `max_usd=0` aborts before any `model_call`; `max_usd=Infinity` never aborts; cost events with `cost=0` do not consume budget.
14. **`cost_capped.ts`** has a top-of-file comment marking it as an upstream-RFC candidate pending production exposure.
15. **`diff_review.ts`** preserves a `build → commit → diff → review` ordering verified by inspecting the trajectory event sequence emitted during a successful run; the test asserts the four expected event names appear in that order.
16. **`diff_review.ts`** test additionally covers: a failed review surfaces the verdict's error path; a clean review allows downstream propagation; an abort during diff aborts the subsequent review.
17. `src/engine/composites/index.ts` re-exports the five composite factories using camelCase ridgeline-side names. Ast-grep rule passes: no `export ... as <camelCaseName>` re-exports of fascicle-snake_case symbols.
18. Ast-grep rule passes: zero `console.*` and zero `process.stdout.write` / `process.stderr.write` calls in `src/engine/composites/`.
19. Ast-grep rule passes: zero emoji literals and zero new ANSI escape sequences in `src/engine/composites/`.
20. `npm run check` is green.
21. `ridgeline build` runs end-to-end (composites are unused by flows yet — flows still call old pipeline executors).
22. `.ridgeline/builds/fascicle-migration/phase-3-check.json` captures a green `.check/summary.json` snapshot at the phase-exit commit.
23. The phase exit commit subject begins with `phase-3:`.

## Spec Reference

- spec.md → "Phase 3 — Tier 1 composites": exactly five composites with the listed names; `Step<i,o>` contract; `describe(...)` decoration; abort propagation; `ctx.on_cleanup` registration; deliberate single-feature choice for `phase`.
- spec.md → "Twelve invariants" — invariant 4 (worktree merge order in index_order regardless of completion order); invariant 10 (adversarial round-cap error shape); invariant 11 (budget cap aborts before exceeding, with documented race semantics).
- constraints.md → "Directory Layout" composites entry; "API Style" Step contract.
- taste.md → "Code Style": Tier 1 composite list, no Tier 2 by default, decorate Steps with `describe`; only one of `archive_feedback`/`adversarial_archived` per phase composite; `graph_drain`/`cost_capped` tagged as upstream-RFC candidates pending production exposure.
- taste.md → "Test Patterns": each Tier 1 composite has ≥ 4 unit tests covering abort, trajectory, cleanup, error surfacing.
