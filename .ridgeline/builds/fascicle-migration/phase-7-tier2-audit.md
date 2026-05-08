# Phase 7 — Tier 2 composite audit

This audit enumerates each Tier 2 composite candidate against the Phase 6 +
Phase 7 atom set (ten atoms total) and the Tier 1 composite set (five
composites). The default outcome — preferred per `taste.md` — is to leave
patterns imperative until 3+ call-site repetitions justify a dedicated
composite. This audit confirms that default holds at this phase exit.

## Methodology

For each candidate composite, count distinct production call sites where the
imperative pattern is reproduced verbatim (or near-verbatim) across the new
substrate (`src/engine/{atoms,composites,flows,adapters}/`). Test
fixtures, generator scripts, and pre-migration pipeline files are excluded.

A "promote" disposition requires **≥ 3 call-site repetitions** AND a clear
shared shape that doesn't degrade the pattern when generalized.

## Candidates

### `with_stable_prompt`

**Pattern:** wrap `model_call` with the `stable.prompt.ts` block prepended
to the system prompt and the `ModelCallInput` shaped through
`appendConstraintsAndTasteData` / `appendDesignData`.

**Call-site count:** 9 (every model-bearing atom: builder, reviewer,
planner, refiner, researcher, specialist, specifier, plan.review,
specialist.verdict).

**Shared shape:** `composeSystemPrompt(roleSystem, stable)` is already
extracted into `src/engine/atoms/_shape.ts` and called by every atom. The
ast-grep rule `atom-must-import-stable-prompt` enforces the import
boundary. The remaining "imperative" body is the per-atom `shape*ModelCallInput`
function — but those bodies differ per atom (different sections,
different ordering, different optional inputs), so they cannot be
collapsed into a single composite without losing per-atom legibility.

**Disposition:** **DEFER**. The reusable substrate is already a
helper module (`_shape.ts`) — not a composite. Promoting it to a Tier 2
composite (e.g., `with_stable_prompt(modelCall, parts)`) would obscure
the per-atom shaper bodies with no reduction in repetition.

### `with_handoff`

**Pattern:** append handoff-target instruction + handoff.md + cross-phase
discoveries section to a model_call user prompt.

**Call-site count:** 1 (builder.atom.ts only — `handoffMd`,
`handoffTargetPath`, `discoveriesSection` are builder-specific).

**Disposition:** **DEFER**. Single call site; promoting to a Tier 2
composite is premature.

### `specialist_panel`

**Pattern:** dispatch N specialists in parallel, gather drafts, optionally
run cross-annotation pass, optionally detect agreement and skip
synthesis, then run synthesizer.

**Call-site count:** 1 in the new substrate (no flow consumes this yet —
Phase 8/9 flows will). The pre-migration pattern lives in
`src/engine/pipeline/ensemble.exec.ts` and is consumed by `invokePlanner`
(planning), `invokeSpecifier` (specifying), and the research stage —
three call sites in the legacy code.

**Disposition:** **DEFER until Phase 8/9 produces production callers**.
The legacy `ensemble.exec.ts` is the de-facto Tier 2 surface; when
migrating its three call sites to the new substrate, evaluate whether a
dedicated `specialist_panel` composite emerges naturally or whether the
flow-level wiring stays imperative.

### `adversarial_archived`

**Pattern:** run a build/review loop that archives feedback files between
attempts (the `archive_feedback` slot of the existing Tier 1 `phase`
composite).

**Call-site count:** 0 in the new substrate. Per `taste.md`: "Pick
`phase`'s `archive_feedback` slot OR `adversarial_archived` as a Tier 2
decorator — not both." Phase 5's composite layer chose `archive_feedback`
on the `phase` composite; `adversarial_archived` is the alternative
that was deliberately not pursued.

**Disposition:** **REJECT**. Already covered by `phase`'s
`archive_feedback` slot. Promoting `adversarial_archived` would create
two ways to do the same thing, which `taste.md` forbids.

### `resumable`

**Pattern:** wrap a step with a checkpoint store get/set so retries
within the same run skip already-completed work.

**Call-site count:** 0 in the new substrate. Fascicle's runner already
integrates `CheckpointStore` per step; the ridgeline checkpoint store
adapter (`ridgeline_checkpoint_store.ts`) plugs in as the runner's
store. There is no remaining imperative pattern at the call-site layer
that would benefit from a `resumable(step)` wrapper.

**Disposition:** **REJECT**. The capability lives in the runner, not at
the composite layer.

## Summary

| Candidate              | Repetitions | Disposition |
| ---------------------- | ----------- | ----------- |
| `with_stable_prompt`   | 9 (helper-ized) | Defer (helper module instead) |
| `with_handoff`         | 1           | Defer       |
| `specialist_panel`     | 0 (legacy: 3) | Defer until Phase 8/9 |
| `adversarial_archived` | 0           | Reject (replaced by `phase.archive_feedback`) |
| `resumable`            | 0           | Reject (provided by runner + adapter) |

**Outcome: no Tier 2 composites promoted in this migration.** This
matches the spec's "Default outcome — and expected outcome — is no
promotion" and `taste.md`'s "Only introduce a Tier 2 composite if Phase
4's audit shows 3+ call-site repetitions of the same imperative pattern;
otherwise leave it imperative."

## Future-RFC notes

- `specialist_panel` is the strongest future candidate — re-evaluate at
  the end of Phase 8/9 once the planner / specifier / researcher flows
  have all migrated to the new substrate. If the imperative dispatch +
  agreement-detection + synthesizer wiring repeats verbatim across all
  three flows, promote it.
- `with_stable_prompt` would only become viable if the per-atom shaper
  bodies converge to a small finite set of templates. They have not.
