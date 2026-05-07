## Continuation 1 (2026-05-07T05:21:38Z) — retry attempt 2

### Done

- AC4 — `--help` baseline drift resolved.
  - Regenerated all 22 `baseline/help/*.txt` from current `dist/main.js`
    output.
  - Added `src/__tests__/cli.help.snapshot.test.ts` (23 tests) that
    asserts byte-equality of `program.helpInformation()` against each
    baseline.
  - Made `src/main.ts` minimally importable by gating side effects
    (`enforceFlavourRemoved`, `process.on(...)`, `program.parse()`)
    behind an `isMainModule()` guard. `program` is now exported.
- AC5 — `tsc --emitDeclarationOnly` snapshot test added.
  - Regenerated all 22 `baseline/dts/*.d.ts` from `dist/commands/`
    (now carrying `.js` extensions on relative imports — forced by
    Phase 8's ESM conversion).
  - Added `src/__tests__/cli.dts.snapshot.test.ts` (23 tests) that
    runs `npx tsc --emitDeclarationOnly --outDir <tempdir>` in
    `beforeAll` and compares each emitted file byte-for-byte against
    baseline.
- AC6 — Commander option-set snapshot test added.
  - Generated 18 baselines under
    `.ridgeline/builds/fascicle-migration/baseline/options/` (root +
    17 real subcommands), each a deterministic JSON serialization
    of `cmd.options` (flags / description / defaultValue / mandatory /
    hidden; sorted by `flags`).
  - Added `src/__tests__/cli.options.snapshot.test.ts` (19 tests) that
    asserts byte-equality of the live option set against each baseline.
- AC10 — `src/cli.ts` filename references resolved per option (b).
  - `constraints.md` Directory Layout updated: now references
    `src/main.ts` and records the rename rationale (works around
    fascicle 0.3.8 `dist/index.js:7195` bin self-detection guard) plus
    the condition under which the file may be renamed back.
  - `spec.md` Phase 5/Phase 6 references from `src/cli.ts` to
    `src/main.ts`. Added an "intentional rebaselines" block noting
    help/, dts/, and entry-point-rename trio.
  - `shape.md` `src/cli.ts` → `src/main.ts` (4 occurrences).
  - `phases/08-leaf-flows.md` (this phase's spec body) updated
    `src/cli.ts` → `src/main.ts` (5 occurrences).
  - SIGINT handler at `src/main.ts:59` preserved verbatim inside the
    `isMainModule()` block. AC10's spirit holds.
- `npm run check` green. 1364 unit tests pass (1299 prior + 65 new:
  23 help + 23 dts + 19 options). Captured to
  `.ridgeline/builds/fascicle-migration/phase-8-check.json`.
- Handoff entry appended to
  `.ridgeline/builds/fascicle-migration/handoff.md` documenting the
  retry's changes, implementation notes, verification, and notes for
  Phase 9.

### Notes for next builder

- The `src/__tests__/cli.{help,dts,options}.snapshot.test.ts` trio is
  the regression net going forward. To intentionally update a
  baseline (real product change in flag set or help text):
  - help: regenerate with `for cmd in <list>; do node dist/main.js $cmd --help > .ridgeline/builds/fascicle-migration/baseline/help/$cmd.txt; done`
  - dts: `for f in .ridgeline/builds/fascicle-migration/baseline/dts/*.d.ts; do cp dist/commands/$(basename $f) $f; done` after a fresh `npm run build`
  - options: re-run the inline node script that imports `program`
    from `dist/main.js` and writes per-command JSON files.
- The dts test runs `tsc --emitDeclarationOnly` once per test file
  (~1.6 s in `beforeAll`). If the suite ever needs to be faster, the
  test could compare against the existing `dist/commands/*.d.ts`
  produced by `npm run build` — but that requires dist to be fresh,
  which `npm run check` doesn't guarantee. Leave as-is.
- The fascicle bin self-detection bug is still live. If fascicle 0.4.x
  fixes the guard at `dist/index.js:7195`, the file may be renamed
  back to `src/cli.ts` and `package.json:bin.ridgeline` updated to
  `dist/cli.js`. Phase 9 should track this as a follow-up.
- Phase 9 (build/auto + SIGINT handover) inherits a clean baseline:
  every migrated command is fully snapshot-covered; new flags or
  changed defaults will surface as a failed snapshot test.
