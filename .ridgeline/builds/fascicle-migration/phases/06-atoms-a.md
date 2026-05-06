---
depends_on: [04-engine-factory]
---

# Phase 6: Atoms (part A) — builder, reviewer, planner, refiner, researcher

## Goal

Implement the first five `model_call`-based atoms in `src/engine/atoms/` —
`builder.atom.ts`, `reviewer.atom.ts`, `planner.atom.ts`, `refiner.atom.ts`,
and `researcher.atom.ts` — alongside the byte-stability fixture
infrastructure that all atoms (this phase and the next) rely on. Each atom
follows the canonical shape:

```ts
pipe(promptShaper, model_call({ engine, model, system, schema?, tools? }))
```

…where `promptShaper` is `src/engine/claude/stable.prompt.ts`, preserved
verbatim from the pre-migration code path to maintain prompt-cache hit rate.
Schema-bearing atoms (`reviewer`, `planner`) pass ridgeline's existing Zod
schemas (`review_verdict`, `plan_artifact`) directly to
`model_call({ schema })` so fascicle handles validation and
`schema_repair_attempts` instead of ridgeline's hand-rolled retry loop.

The byte-stability fixture infrastructure includes a frozen `BuilderArgs`
fixture and a comparison harness that asserts the `ModelCallInput` object
passed into `model_call` is structurally identical (same keys, same string
values, same array order) to the pre-migration `ModelCallInput`. This is
the protective net against silent prompt-cache hit-rate regressions.

The old `src/engine/pipeline/*.exec.ts` files remain in place, compile, and
continue to run all existing E2E tests. This phase introduces parallel
implementations only.

## Context

Splitting Phase 6 atoms into two sub-phases addresses reviewer feedback that
a single 10-atom phase exceeded the file-count threshold even at moderate
token counts. This part lands the byte-stability infrastructure (cross-cutting,
referenced by every atom in both halves) and the five atoms whose
implementations exercise the infra most heavily.

`reviewer` and `planner` are schema-bearing — their tests must verify
referential equality of the `schema` parameter passed to `model_call`
(i.e., `expect(call.schema).toBe(reviewVerdictSchema)`), not deep equality.
`builder`, `refiner`, and `researcher` are non-schema-bearing.

## Acceptance Criteria

1. `src/engine/atoms/` contains at minimum, after this phase:
   `builder.atom.ts`, `reviewer.atom.ts`, `planner.atom.ts`,
   `refiner.atom.ts`, `researcher.atom.ts`. (The remaining five atoms and
   `index.ts` land in Phase 7.)
2. Each of the five atoms exports a fascicle `Step` instance and is
   importable individually from its file.
3. Each atom is implemented as `pipe(promptShaper, model_call({ ... }))`
   where `promptShaper` is the symbol exported by
   `src/engine/claude/stable.prompt.ts`. An ast-grep rule asserts that
   every file in `src/engine/atoms/` calling `model_call(` also imports
   `stable.prompt.ts` (or imports a function that ultimately re-exports
   it). Adding an atom that bypasses the shaper fails `npm run check`.
4. Zero atoms in this phase import from `src/engine/pipeline/` or from
   `src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}`.
   Verified by grep.
5. The byte-stability fixture lives at
   `src/engine/atoms/__tests__/__fixtures__/byte-stability.<atom>.json`
   for each schema-bearing atom in this phase plus `builder` (5 fixtures
   total). Each fixture records the frozen `BuilderArgs` (or analogous
   args object) and the expected `ModelCallInput` object.
6. A test file `src/engine/atoms/__tests__/byte-stability.test.ts` asserts
   that for each atom in this phase, the `ModelCallInput` object passed
   into `model_call` matches the recorded fixture under structural
   equality (same keys in same order, same string values, same array
   order). This is the prompt-cache hit-rate regression net.
7. `reviewer.atom.ts` and `planner.atom.ts` each have a unit test under
   `src/engine/atoms/__tests__/<atom>.test.ts` asserting that the
   `schema` parameter passed to `model_call` is referentially equal
   (`expect(call.schema).toBe(...)`) to the Zod schema imported from the
   existing schemas module — not merely deep-equal.
8. Each of the five atoms in this phase has at least one unit test under
   `src/engine/atoms/__tests__/<atom>.test.ts` using a stub Engine that
   returns canned `GenerateResult` values. No test in this phase exercises
   the real `claude_cli` provider. Test fixtures pass `skip_probe: true`
   to fascicle's claude_cli provider where applicable.
9. The old `src/engine/pipeline/*.exec.ts` files remain on disk, compile
   under `tsc`, and continue to be the code path executed by
   `ridgeline build` — no command path consumes the new atoms yet.
10. `npm run check` exits with zero status.
11. `ridgeline build` runs end-to-end via the old pipeline.
12. `.ridgeline/builds/fascicle-migration/phase-6-check.json` exists and
    is a verbatim copy of `.check/summary.json` at this phase's exit commit.

## Spec Reference

From `spec.md`, "Phase 4 — Atoms (model_call-based pipeline steps)":
> Each atom is `pipe(promptShaper, model_call({ engine, model, system,
> schema?, tools? }))` where `promptShaper` is
> src/engine/claude/stable.prompt.ts (preserved verbatim to maintain
> prompt-cache hit rate). Schema-bearing atoms pass ridgeline's existing
> Zod schemas to model_call so fascicle handles validation and
> `schema_repair_attempts`.

From `taste.md`, "Code Style":
> Preserve prompt-cache hit rate by routing every `model_call` through
> `stable.prompt.ts` as the `ModelCallInput` shaper. If any atom skips
> it, prompt-cache hit rate degrades silently and costs balloon without a
> visible signal — this is enforced by ast-grep.
