---
depends_on: [06-atoms-a]
---

# Phase 7: Atoms (part B), Tier 2 audit, capability re-verification

## Goal

Implement the remaining five `model_call`-based atoms — `specialist.atom.ts`,
`specifier.atom.ts`, `sensors.collect.atom.ts`, `plan.review.atom.ts`,
`specialist.verdict.atom.ts` — and the `src/engine/atoms/index.ts` barrel
that re-exports the full ten-atom set. Land the Tier 2 audit document
(`phase-7-tier2-audit.md`) that enumerates each Tier 2 composite candidate
with a counted call-site repetition number and concludes whether any are
promoted (default outcome: none). Re-verify the
`baseline/capability-matrix.md` against the pinned fascicle version's
documentation and source; record any drift and resolve it before phase exit.

The byte-stability fixture infrastructure from Phase 6 is extended to cover
the schema-bearing atoms in this half: `plan.review` and
`specialist.verdict` use ridgeline's existing `plan_artifact` and
`specialist_verdict` Zod schemas respectively, and their tests assert
referential equality of the `schema` parameter passed to `model_call`.

The old `src/engine/pipeline/*.exec.ts` files still compile and still run
the production pipeline at this phase's exit. Phase 8 begins consuming the
new atoms via leaf command flows.

## Context

This phase consumes the byte-stability infrastructure landed in Phase 6 and
completes the ten-atom set. The Tier 2 audit is the gate: only candidates
with 3+ call-site repetitions are promoted to dedicated composite files in
this migration. The default outcome is to leave Tier 2 patterns imperative
(per taste guidance) and tag them in the audit doc as future-RFC candidates.

Capability-matrix re-verification is non-trivial: fascicle 0.3.x's
documented `claude_cli` capability surface (sandbox kinds, auth modes,
streaming events, cost reporting, AbortSignal propagation, model alias set,
`startup_timeout_ms`, `stall_timeout_ms`, `skip_probe`) must match what the
Phase 1 baseline recorded. Any mismatch blocks phase exit — either the
matrix is updated to reflect actual capabilities or the implementation in
Phase 4's engine factory is updated to align.

`specialist.atom.ts` is non-schema-bearing — it produces narrative output
that is later parsed by `specialist.verdict.atom.ts`, which IS
schema-bearing.

## Acceptance Criteria

1. `src/engine/atoms/` contains exactly: `builder.atom.ts`,
   `reviewer.atom.ts`, `planner.atom.ts`, `refiner.atom.ts`,
   `researcher.atom.ts` (from Phase 6), plus `specialist.atom.ts`,
   `specifier.atom.ts`, `sensors.collect.atom.ts`, `plan.review.atom.ts`,
   `specialist.verdict.atom.ts`, and `index.ts`. The barrel re-exports
   all ten atoms.
2. Each of the five new atoms in this phase is implemented as
   `pipe(promptShaper, model_call({ ... }))` where `promptShaper` is the
   symbol exported by `src/engine/claude/stable.prompt.ts`. The ast-grep
   rule from Phase 6 continues to enforce this for the new atoms.
3. Zero atoms in this phase import from `src/engine/pipeline/` or from
   `src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}`.
   Verified by grep across all of `src/engine/atoms/`.
4. Each of the five new atoms has at least one unit test under
   `src/engine/atoms/__tests__/<atom>.test.ts` using a stub Engine. No
   test in this phase exercises the real `claude_cli` provider. Test
   fixtures pass `skip_probe: true` where applicable.
5. `plan.review.atom.ts` and `specialist.verdict.atom.ts` each have a unit
   test asserting that the `schema` parameter passed to `model_call` is
   referentially equal (`expect(call.schema).toBe(...)`) to the Zod schema
   imported from the existing schemas module — not merely deep-equal.
6. The byte-stability fixture set is extended to include
   `byte-stability.<atom>.json` for each of the five new atoms (or the
   subset for which a frozen args fixture is reasonable — at minimum
   `plan.review`, `specialist.verdict`, and `specifier`). The
   byte-stability test file from Phase 6 covers the new fixtures with the
   same structural-equality assertion.
7. `.ridgeline/builds/fascicle-migration/phase-7-tier2-audit.md` exists
   and lists each Tier 2 composite candidate
   (`with_stable_prompt`, `with_handoff`, `specialist_panel`,
   `adversarial_archived`, `resumable`) with: (a) a counted call-site
   repetition number across the migrated codebase to date; (b) a
   promote-or-defer disposition; (c) a one-line rationale. Only candidates
   with 3+ repetitions are promoted to dedicated composite files in this
   migration. The default outcome — and expected outcome — is no
   promotion.
8. `.ridgeline/builds/fascicle-migration/baseline/capability-matrix.md` is
   re-verified against the pinned fascicle version's documentation and
   source. Any drift is recorded inline in the matrix with a "Drift
   resolved at Phase 7" note plus the resolution. Mismatches that cannot
   be resolved block phase exit.
9. `src/engine/atoms/index.ts` re-exports each of the ten atom Step
   factories. A test asserts that importing each atom by name from the
   barrel yields a non-null Step instance.
10. The old `src/engine/pipeline/*.exec.ts` files remain on disk, compile,
    and continue to be the code path executed by `ridgeline build`.
11. `npm run check` exits with zero status.
12. `ridgeline build` runs end-to-end via the old pipeline.
13. `.ridgeline/builds/fascicle-migration/phase-7-check.json` exists and
    is a verbatim copy of `.check/summary.json` at this phase's exit commit.

## Spec Reference

From `spec.md`, "Phase 4 — Atoms (model_call-based pipeline steps)":
> An audit document `.ridgeline/builds/fascicle-migration/phase-4-tier2-audit.md`
> lists each Tier 2 composite candidate (with_stable_prompt, with_handoff,
> specialist_panel, adversarial_archived, resumable) with a counted
> call-site repetition number; only candidates with 3+ repetitions are
> promoted. Default outcome: no Tier 2 composites this migration.
> `capability-matrix.md` is re-verified at this phase against the pinned
> fascicle version's docs/source and any drift is recorded; mismatches
> block phase exit.

(Note: spec text references `phase-4-tier2-audit.md`; this plan uses
`phase-7-tier2-audit.md` to align with the re-numbered phases. Filename
differs; intent is identical.)
