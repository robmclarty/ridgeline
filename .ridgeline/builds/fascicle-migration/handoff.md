## Phase 1: Foundation and baseline corpus

### What was built

This phase verified that the foundation and baseline corpus laid down in
prior work satisfies every acceptance criterion in the re-planned
01-foundation-baseline phase. Two small adjustments were made:

1. **CHANGELOG.md restructure.** The `Breaking — for consumers` section
   under `v0.12.0` was moved to be the first section of the entry (above
   `Added`). This satisfies acceptance criterion 7's strict reading: "the
   entry's first bullet — placed at the top of the entry — prominently
   calls out the engines.node bump from >=20 to >=24 as BREAKING for
   consumers." The bullet content itself is unchanged.
2. **`phase-1-check.json` captured** at
   `.ridgeline/builds/fascicle-migration/phase-1-check.json` as a verbatim
   copy of `.check/summary.json` at this phase's exit commit. All eight
   checks (types, lint, struct, agents, dead, docs, spell, test) report
   `ok: true` with `exit_code: 0`.

### Decisions

- **No re-recording of baseline fixtures.** The baseline corpus under
  `.ridgeline/builds/fascicle-migration/baseline/` was already complete
  from prior work: `help/` (22 files), `dts/` (22 files), `fixtures/`
  (trajectory.jsonl, state.json, budget.json, phases/, error-shapes.json,
  builder-modelcall-input.json), `mutation-score.json` (placeholder with
  documented EPERM blocker + regeneration recipe),
  `capability-matrix.md` (verified against fascicle 0.3.8 source),
  `sandbox-allowlist.{semi-locked,strict}.json`, `exit-codes.md`,
  `greywall-tests.txt`, and `README.md`. Re-recording would invalidate the
  golden artifacts that later phases assert byte equality against.
- **`engines.node` left at `">=24.0.0"`** rather than `">=24"`. Both
  expressions are semantically equivalent in npm's semver parser; the
  more explicit form was chosen by the prior phase and is unambiguous.
- **No `.github/workflows/` directory.** This repository does not host
  CI workflow files in-tree, so acceptance criterion 4 is satisfied
  trivially (zero matches for any Node 20 reference because no workflow
  files exist).

### Deviations

None from the spec.

The `mutation-score.json` baseline records `{ "score": null, "captured":
false }` per the spec's allowance: the active sandbox blocks Stryker's
TCP-IPC. The unblock recipe is recorded in the same file (a heredoc'd
Stryker config to run outside greywall). Phase 7 must capture the
absolute pre-migration score before asserting the new-scope gate.

### Notes for next phase

- Old `src/engine/pipeline/` and `src/engine/claude/{claude.exec,
  stream.parse,stream.result,stream.display,stream.types}.ts` remain on
  disk, untouched. The four scaffolded directories
  (`src/engine/{flows,atoms,composites,adapters}/`) each contain only an
  empty `index.ts` body (`export {}`) — no fascicle code is wired up
  yet.
- The pinned fascicle version is `0.3.8` (exact). The required peer `ai`
  is intentionally NOT installed because the claude_cli provider built
  into fascicle does not import `ai` at runtime; npm warns about the
  missing peer at install time. This is documented in
  `baseline/capability-matrix.md` ("Required peers vs ridgeline policy").
- The spec uses Phase numbers 0–7 in places (`Phase 0 — Scaffold...`,
  `Phase 7 — Cleanup...`) and 1–8 / 1–12 in others (this re-planned
  phase is `01-foundation-baseline`, the artifact is
  `phase-1-check.json`). Later phases will need to keep the
  artifact-numbering convention (`phase-<N>-check.json` matching the
  re-plan's phase index) consistent with the re-planned phase names.
- The CHANGELOG `v0.12.0` entry now has `Breaking — for consumers` as
  its first section. If subsequent phases add more breaking changes
  before the v0.12.0 release, append to that section rather than
  introducing a new top-level callout.
