# Phase 5: Model-Call-Based Atoms

## Goal

Replace the imperative behavior of `src/engine/pipeline/*.exec.ts` with declarative `model_call`-based atoms in `src/engine/atoms/`, alongside the existing pipeline (which remains compiling and operational until Phase 8). Each atom shares the same fundamental shape: `pipe(promptShaper, model_call({ engine, model, system, schema?, tools? }))` where `promptShaper` is `src/engine/claude/stable.prompt.ts` preserved verbatim to maintain prompt-cache hit rate.

Schema-bearing atoms (reviewer, planner, specialist) hand ridgeline's existing Zod schemas (`review_verdict`, `plan_artifact`, `specialist_verdict`) directly to `model_call` so fascicle owns validation and `schema_repair_attempts`. Each atom has a vitest unit test using a stub Engine that returns canned `GenerateResult` values; no test exercises the real `claude_cli` provider, and test fixtures pass `skip_probe: true` to prevent any network probe.

A byte-stability fixture test guards prompt-cache hit rate: for a frozen `BuilderArgs` input (Phase 1 baseline), the `ModelCallInput` passed into `model_call` must be structurally identical to the pre-migration input — same keys, same string values, same array order. Drift here costs money silently. A Tier 2 audit document enumerates each Tier 2 candidate (`with_stable_prompt`, `with_handoff`, `specialist_panel`, `adversarial_archived`, `resumable`) with a counted call-site repetition; only candidates with 3+ repetitions are promoted, default outcome is no Tier 2 composites this migration.

A small integration smoke test composes one atom with one Tier 1 composite (`phase`) using a stub Engine and asserts the substrate runtime executes end-to-end — catching any fascicle-runtime issue early, before flows in later phases depend on assumptions that haven't been validated against a real composition.

The Phase 1 capability matrix is re-verified at this phase against the pinned fascicle version's docs/source; any drift is recorded and blocks phase exit until reconciled.

## Context

Phases 2-4 landed adapters, sandbox policy, and Tier 1 composites. This phase adds the model-calling layer (atoms) that flows will compose using the composites. The legacy pipeline still runs every command end-to-end — atoms exist as parallel implementations but aren't wired into any command yet (that happens in Phase 6).

The naming-convention boundary stays explicit: every atom imports fascicle's snake_case `pipe`, `model_call`, `describe` and exports a ridgeline-side camelCase factory. `stable.prompt.ts` is preserved verbatim; do not rewrite or refactor it during this phase even if opportunities arise — its byte stability is the regression net for prompt-cache hit rate.

## Acceptance Criteria

1. `src/engine/atoms/` contains exactly: `builder.atom.ts`, `reviewer.atom.ts`, `planner.atom.ts`, `specialist.atom.ts`, `refiner.atom.ts`, `researcher.atom.ts`, `specifier.atom.ts`, `sensors.collect.atom.ts`, `plan.review.atom.ts`, `specialist.verdict.atom.ts`, `index.ts`.
2. Each atom file exports a `Step` and is importable from `src/engine/atoms/index.ts`. Atom factories are named in camelCase ridgeline-side; ast-grep rule passes: no `export ... as <camelCaseName>` re-exports of fascicle-snake_case symbols.
3. Zero atoms import from `src/engine/pipeline/` or from `src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}` — verified by an ast-grep rule that fails `npm run check` if any such import is added.
4. `stable.prompt.ts` is imported by every atom that calls `model_call` — verified by ast-grep: for each atom file in the list above that contains a `model_call(` call, the file must also import from `claude/stable.prompt.ts`.
5. `stable.prompt.ts` is byte-equal to its pre-Phase-5 contents (verified by `git diff`). No refactoring, no formatting changes.
6. Byte-stability fixture test: a frozen `BuilderArgs` input (matching the Phase 1 baseline `builder-modelcall-input.json`) is fed into the new `builder.atom.ts` pipeline; the `ModelCallInput` object passed into `model_call` is captured (via a stub Engine that records its argument) and asserted structurally identical (same keys, same string values, same array order) to the baseline snapshot.
7. Reviewer atom unit test: the `schema` parameter passed to `model_call` is the exact Zod schema imported from the existing schemas module — assertion is referential equality (`===`) via the stub.
8. Planner atom unit test: same as reviewer — the `plan_artifact` Zod schema is passed by reference identity.
9. Specialist atom unit test: same as reviewer — the `specialist_verdict` Zod schema is passed by reference identity.
10. Each atom has at least one vitest unit test under `src/engine/atoms/__tests__/<atom>.test.ts` using a stub Engine returning canned `GenerateResult` values. No test exercises the real `claude_cli` provider; test fixtures pass `skip_probe: true` to the engine config.
11. Each atom decorates its Step with `describe('<atom-name>')` so trajectory events carry stable, human-readable names — verified by ast-grep.
12. Substrate composition smoke test: at least one test composes a real atom (e.g., `builderAtom`) with the real Tier 1 `phase` composite using a stub Engine, runs it via fascicle's `run(...)`, and asserts: (a) the run completes without runtime error; (b) trajectory events are recorded for both the atom and the composite by `describe` name; (c) the registered `ctx.on_cleanup` handlers fire. This is the first end-to-end exercise of fascicle's runtime against ridgeline-side code in the migration.
13. An audit document `.ridgeline/builds/fascicle-migration/phase-4-tier2-audit.md` lists each Tier 2 composite candidate (`with_stable_prompt`, `with_handoff`, `specialist_panel`, `adversarial_archived`, `resumable`) with a counted call-site repetition number obtained by enumerating repetitions of the matching imperative pattern across the codebase.
14. Default Tier 2 outcome: only candidates with 3+ repetitions are promoted; if no candidate hits the threshold, the audit document explicitly records "no Tier 2 composites this migration."
15. If any Tier 2 candidate scores 3+ repetitions, that composite is implemented in `src/engine/composites/<name>.ts` with the same four cross-cutting tests required of Tier 1 composites (abort, trajectory, cleanup, error surfacing) and at least 4 distinct `test()`/`it()` calls.
16. `.ridgeline/builds/fascicle-migration/baseline/capability-matrix.md` is re-verified at this phase against the pinned fascicle version's docs/source: sandbox kinds, auth modes, streaming events, cost reporting, AbortSignal propagation, model alias set, `startup_timeout_ms` default, `stall_timeout_ms` default, `skip_probe` behavior, `install_signal_handlers` default. Any drift is recorded in the file with a `DRIFT:` prefix line and blocks phase exit until reconciled (either by adjusting the pinned fascicle version, by adjusting the engine factory plan for Phase 6, or by documenting the drift as accepted).
17. Old `src/engine/pipeline/*.exec.ts` files remain in place, compile, and continue to run all existing E2E tests at this phase exit. Verified by running the existing E2E suite and confirming the same tests pass as at Phase 4 exit.
18. Ast-grep rule passes: zero `console.*`, zero `process.stdout.write` / `process.stderr.write`, zero emoji literals, zero new ANSI escape sequences in `src/engine/atoms/`.
19. `npm run check` is green.
20. `ridgeline build` runs end-to-end via the OLD pipeline (the new atoms exist but are not yet wired into any flow).
21. `.ridgeline/builds/fascicle-migration/phase-4-check.json` captures a green `.check/summary.json` snapshot at the phase-exit commit.
22. The phase exit commit subject begins with `phase-4:`.

## Spec Reference

- spec.md → "Phase 4 — Atoms (model_call-based pipeline steps)": atom shape `pipe(promptShaper, model_call({ ... }))`; preserved `stable.prompt.ts`; Zod schemas via `model_call({ schema })`; capability matrix re-verification; Tier 2 audit with 3+-repetition threshold.
- spec.md → "Twelve invariants" — invariant 8 (prompt-cache hit rate preserved via byte-stable `ModelCallInput`).
- constraints.md → "API Style": atom shape; "Test and Mutation Constraints": `skip_probe: true` for unit tests; stub Engine pattern.
- taste.md → "Code Style": route every `model_call` through `stable.prompt.ts`; Tier 2 audit with 3+-repetition threshold; default no Tier 2 composites.
- taste.md → "Test Patterns": stub Engine pattern for atom tests; do not call real `claude_cli` provider in unit tests.
