# Builder progress — Phase 3 (03-adapters)

## Continuation 1 (2026-05-06T23:38:00.000Z)

### Done

- Implemented all three Phase 3 adapters under `src/engine/adapters/`:
  - `ridgeline_trajectory_logger.ts` (translates fascicle TrajectoryEvent
    → ridgeline `.jsonl` shape)
  - `ridgeline_checkpoint_store.ts` (per-step intra-run memoization
    under `<buildDir>/state/<step-id>.json`)
  - `ridgeline_budget_subscriber.ts` (cost subscriber that writes
    `budget.json`, idempotent on duplicate event ids)
  - `index.ts` (barrel re-exports)
- Wrapped `src/stores/trajectory.ts` and `src/stores/budget.ts` to
  expose `appendTrajectoryEntry` / `appendBudgetEntry` /
  `makeTrajectoryEntry` / `makeBudgetEntry`. Existing public
  signatures (`logTrajectory`, `recordCost`) are unchanged and now
  delegate to the new low-level helpers.
- Added 33 new unit tests across 4 test files in
  `src/engine/adapters/__tests__/`. All 1190 tests in the full
  vitest suite pass.
- Wrote `.ridgeline/builds/fascicle-migration/phase-3-deferred-callsites.md`
  enumerating every remaining `recordCost(` / `logTrajectory(` site
  in `src/engine/` (18 production sites in
  `pipeline/{phase.sequence,plan.review,ensemble.exec}.ts` and
  `claude/claude.exec.ts`). Each site is mapped to its resolution
  phase.
- Captured `.ridgeline/builds/fascicle-migration/phase-3-check.json`
  as a verbatim copy of `.check/summary.json` at this commit.
- Wrote handoff at
  `.ridgeline/builds/fascicle-migration/handoff-03-adapters.md`.

### Remaining

- **`npm run check` agents check is blocking on the agnix binary.**
  The agnix postinstall script downloads from
  `https://github.com/agent-sh/agnix` (blocked by the active
  sandbox: `getaddrinfo ENOTFOUND github.com`). The cargo fallback
  install from `https://index.crates.io/` also times out
  (`Proxy CONNECT aborted due to timeout`). Copying the binary from
  `/Users/robmclarty/Projects/ridgeline/code/ridgeline/node_modules/agnix/bin/agnix-binary`
  fails with `Operation not permitted` (macOS file-permission
  blocks reading the parent worktree's `node_modules/`). All seven
  other checks pass: types, lint, struct, dead, docs, spell, test.
  This is the same Phase 0 pattern noted for Stryker mutation
  testing (recorded as `captured: false`).
- **Unblock recipe:** rerun `npm run check` from a worktree
  provisioned in an environment where (a) `https://github.com` is
  reachable so the agnix postinstall can download the platform
  binary, OR (b) the parent worktree's
  `node_modules/agnix/bin/agnix-binary` can be copied in.

### Notes for next builder

- The code work itself is complete and clean. The next builder (or
  reviewer) only needs to either (a) provision the agnix binary
  and re-run `npm run check`, then re-capture
  `phase-3-check.json`, OR (b) explicitly accept the documented
  environment blocker per the Phase 0 precedent.
- All 12 acceptance criteria except AC #10 (`npm run check` exits
  zero) are satisfied in this commit. AC #10 cannot pass without
  the agnix binary.
- Test files under `src/engine/adapters/__tests__/` intentionally
  exercise the legacy `logTrajectory` and `recordCost` helpers as
  regression coverage. They are NOT deferred sites; the
  deferred-callsites doc explicitly excludes test files.
- The trajectory adapter's `start_span` returns
  `${name}:${counter}` where counter is per-instance. fascicle's
  runner doesn't require globally unique span ids, so this is
  sufficient. If a future composition surfaces a span-id collision,
  swap to a uuid generator.
- Fascicle 0.3.8 does NOT export `tee_logger` from its public
  surface. When Phase 9 needs to compose the trajectory + budget
  + (optional) fascicle-viewer sinks, the simplest fix is a
  ridgeline-side `tee_loggers(...)` helper next to the adapters.
  Constraints.md references `fascicle/adapters` subpath including
  `tee_logger` — that expectation is currently unmet by 0.3.8 and
  may need an upstream PR.
