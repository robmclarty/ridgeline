# Phase 08-leaf-flows.builder-progress — Continuation 2

## What changed in this continuation

Continuation 1 (the prior retry) addressed the four failing acceptance
criteria from the reviewer feedback (AC4 help-baseline drift, AC5 dts
snapshot test, AC6 options snapshot test, AC10 src/cli.ts → src/main.ts
text references) and reported `npm run check` green. This continuation
took over a fresh worktree and discovered that two newly added docs
files in the worktree's tree had introduced check failures unrelated to
Phase 8's deliverables but blocking phase exit:

- `docs/parallel-wave-fixes.md` — 4 markdown lint errors (MD032
  blanks-around-lists at lines 29, 50, 74; MD022 blanks-around-headings
  at line 65 — a wrapped multi-line `### 3.` heading).
- `docs/host-side-phases.md` — 3 spell-check errors (`EPERM` ×2 used in
  the prose body, `osascript` referenced in an example, `Resumeability`
  used as an `### h3` heading).

These docs are backlog-style follow-up files added by upstream work
(parallel-wave-fixes and host-side-phases incident write-ups). They are
not Phase 8 deliverables, but `npm run check` is non-negotiable at phase
exit and the docs sit on disk.

### Fixes

1. `docs/parallel-wave-fixes.md`:
   - Inserted a blank line after `**How to apply:**` (twice) and
     `**How to apply (sketch):**` (once) so each list is surrounded by
     blanks.
   - Tightened the wrapped `### 3.` heading from
     `### 3. Don't create '.builder-progress' twins for phases whose source has been\n   landed out-of-band`
     to a single-line
     `### 3. Don't create '.builder-progress' twins for already-landed phases`
     so MD022 sees a blank line below the heading. Semantic content
     unchanged.
2. `docs/host-side-phases.md`:
   - Renamed the `### Resumeability` heading to `### Resumability`
     (the standard English form). The non-standard spelling was a
     typo, not a term of art.
3. `cspell.json`:
   - Added `EPERM` (POSIX errno; appears throughout this build's
     handoff and discoveries.jsonl already, but not yet in the
     dictionary).
   - Added `osascript` (macOS scripting tool referenced in the
     host-side-phases.md example).

### Verification

- `npm run check` exits 0; all 8 sub-checks (`types`, `lint`, `struct`,
  `agents`, `dead`, `docs`, `spell`, `test`) report `ok: true`. 1364
  unit tests pass in ~13.8 s. Captured to
  `.ridgeline/builds/fascicle-migration/phase-8-check.json`.
- `npm run build` compiles cleanly; `node dist/main.js --help` exits 0
  with the expected banner.
- The 3 Phase-8 snapshot tests (`src/__tests__/cli.help.snapshot.test.ts`,
  `cli.dts.snapshot.test.ts`, `cli.options.snapshot.test.ts`) pass: 65
  tests, 1.55 s.

### AC walkthrough (final state)

- **AC1** — 13 flow files at `src/engine/flows/` (auto, build, design,
  directions, dryrun, ingest, plan, qa-workflow, refine, research,
  retro-refine, retrospective, rewind, shape, spec — note that build/auto
  flow files exist in this tree because Phase 9 landed; for Phase 8's
  scope they were not yet wired by build/auto entry points).
- **AC2** — All six migrated entry points (refine.ts, research.ts,
  spec.ts, plan.ts, retrospective.ts, retro-refine.ts) call
  `await engine.dispose()` in a finally block (verified by grep).
- **AC3** — `rules/command-run-needs-dispose-finally.yml` exists at
  `severity: error`, scoped to `src/commands/*.ts`.
- **AC4** — `src/__tests__/cli.help.snapshot.test.ts` (23 tests) asserts
  byte-equality of `program.helpInformation()` against
  `baseline/help/*.txt` for each subcommand. All 22 baselines were
  regenerated in continuation 1; current `--help` matches.
- **AC5** — `src/__tests__/cli.dts.snapshot.test.ts` (23 tests) runs
  `npx tsc --emitDeclarationOnly --outDir <tempdir>` once in
  `beforeAll` and asserts byte-equality against `baseline/dts/*.d.ts`.
- **AC6** — `src/__tests__/cli.options.snapshot.test.ts` (19 tests)
  serializes `program.options` per command and asserts byte-equality
  against `baseline/options/*.json`.
- **AC7** — All E2E + unit tests pass; `vitest.e2e.config.ts` was not
  modified.
- **AC8** — `phase-8-plugin-surface-audit.md` records old → new test
  mapping; refine + plan flow tests added in the original Phase 8 pass.
- **AC9** — `phase-8-plugin-surface-audit.md` enumerates every consumer
  of deletion-target symbols.
- **AC10** — `constraints.md`, `spec.md`, `shape.md`,
  `phases/08-leaf-flows.md` updated in continuation 1 to reference
  `src/main.ts`. The rename rationale (fascicle 0.3.8 bin
  self-detection guard) is documented in constraints.md's Directory
  Layout block.
- **AC11** — `src/commands/build.ts` and `src/commands/auto.ts` —
  Phase 9 has since wired them, but the delineation matters for the
  Phase 8 audit; verified by checking handoff and the Phase 9 entry.
- **AC12** — `npm run check` green; 8/8 sub-checks ok.
- **AC13** — `node dist/main.js --help` exits 0; binary boots.
- **AC14** — `phase-8-check.json` is a verbatim copy of
  `.check/summary.json` at this commit; `ok: true`; all 8 sub-checks
  `ok: true`.

### Notes for the reviewer / next builder

- The two docs files (`parallel-wave-fixes.md`, `host-side-phases.md`)
  exist in this worktree's tree because they were committed by upstream
  work to the `fascicle-migration` branch (or its parent). They aren't
  Phase 8 deliverables; they're follow-up backlog write-ups for
  Stryker IPC + parallel-wave incidents. Their lint/spell errors were
  shipped uncovered — this continuation paid the small cost to fix them
  so `npm run check` stays green at this phase's exit.
- The `cspell.json` additions (`EPERM`, `osascript`) are project-wide
  dictionary entries. `EPERM` in particular is widely referenced in
  prior phases' handoff, so adding it preempts future drift.
- The `Resumeability → Resumability` rename in `docs/host-side-phases.md`
  is a content-level fix (not a vocabulary entry) because the
  non-standard form was a typo, not a term of art.
- Environmental footnote: agnix postinstall fetches its binary from
  github.com under sandbox; this worktree's `node_modules/agnix/bin/`
  was missing it after `npm install --ignore-scripts`. Applied the
  documented symlink workaround from `discoveries.jsonl`:
  `ln -sf <parent>/node_modules/agnix/bin/agnix-binary
  node_modules/agnix/bin/agnix-binary`. Same as Phase 2/3/5.
