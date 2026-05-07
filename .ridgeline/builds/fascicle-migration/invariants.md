# Twelve §7 invariants — checklist

Each row maps one of the twelve §7 invariants from `shape.md` to the
test file (and `it(...)` test name) that asserts it. Failures of any row
block phase merges — the corresponding test must stay green at every
phase exit.

The `phase-<N>-check.json` artefacts under
`.ridgeline/builds/fascicle-migration/` are the canonical exit-gate
record for invariant 12. The other eleven invariants are covered by
named test cases.

| # | Invariant | Test file | Test name |
|---|-----------|-----------|-----------|
| 1 | Visible behavior unchanged (`--help` byte-equal) | `src/__tests__/cli.help.snapshot.test.ts` | `${name} --help matches baseline/help/${file}` (parameterised; one case per subcommand) |
| 2 | File-format stability (state.json / trajectory.jsonl / budget.json / phases markdown) | `src/engine/adapters/__tests__/ridgeline_trajectory_logger.test.ts` | `preserves byte equality across the baseline trajectory.jsonl fixture` |
| 2 | File-format stability (cont.) — budget byte equality | `src/engine/adapters/__tests__/ridgeline_budget_subscriber.test.ts` | `appends a cost entry on a ridgeline_cost event` (plus `store_wrapping.test.ts`) |
| 2 | File-format stability (cont.) — state.json across runs | `src/stores/__tests__/state.test.ts` | `loads state.json when it exists` |
| 3 | Exit-code preservation (incl. 130 on SIGINT) | `src/engine/flows/__tests__/build.flow.sigint.test.ts` | `on SIGINT mid-run: exits 130, removes the worktree, kills the spawned child, and runs cleanup exactly once` |
| 4 | Worktree merge order (index_order regardless of completion) | `src/engine/composites/__tests__/worktree_isolated.test.ts` | `merges in index_order regardless of completion order (input [2,0,1] with stalled high-index phases)` |
| 5 | SIGINT semantics — single handler, exit 130, no orphans, no double-cleanup | `src/engine/flows/__tests__/build.flow.sigint.test.ts` | `on SIGINT mid-run: exits 130, removes the worktree, kills the spawned child, and runs cleanup exactly once` |
| 5 | SIGINT semantics (cont.) — fascicle default installs handler | `src/engine/__tests__/fascicle.signal.default.test.ts` | covers `install_signal_handlers` default behaviour |
| 6 | Cross-process resume (state.json + tags only; CheckpointStore is intra-run) | `src/engine/flows/__tests__/build.flow.resume.test.ts` | `CheckpointStore writes only under <buildDir>/state/, never to state.json` and `state.json from a prior process can be loaded after the inner run completes (outer resume layer untouched)` |
| 7 | Sandbox enforcement parity | `src/engine/__tests__/sandbox.parity.test.ts` | `policy uses the new buildPath placement; legacy uses repoRoot — both are per-invocation parameters` (plus the eight other parity assertions in the file) |
| 8 | Prompt-cache hit rate preserved (stable.prompt byte-stable) | `src/engine/atoms/__tests__/byte-stability.test.ts` | `builder shape is byte-stable for frozen args` (and the eight sibling per-atom byte-stability cases) |
| 9 | Sandbox allowlist not widened | `src/engine/__tests__/sandbox.parity.test.ts` | `policy network_allowlist is a subset of (or equal to) the pre-migration host set — no widening` |
| 9 | Sandbox allowlist not widened (cont.) — frozen at runtime | `src/engine/claude/__tests__/sandbox.policy.test.ts` | `DEFAULT_NETWORK_ALLOWLIST_SEMI_LOCKED is frozen to prevent runtime mutation` and `DEFAULT_NETWORK_ALLOWLIST_STRICT is frozen to prevent runtime mutation` |
| 10 | Adversarial round-cap error shape (`Error("Retries exhausted")`) | `src/engine/composites/__tests__/phase.test.ts` | `throws Error('Retries exhausted') after maxRetries+1 unsuccessful rounds matching the baseline fixture` |
| 10 | Adversarial round-cap error shape (cont.) — fixture replay | `src/engine/__tests__/error-shapes.test.ts` | `adversarial_round_cap_exhaustion: phase composite throws Error('Retries exhausted')` |
| 11 | Budget cap aborts before exceeding (race semantics documented) | `src/engine/composites/__tests__/cost_capped.test.ts` | `aborts the inner step on cumulative 0.50 + 0.45 + 0.10 = 1.05 with max_usd 1.00 (race: at most one in-flight step exceeds)` |
| 11 | Budget cap aborts before exceeding (cont.) — flow-level integration | `src/engine/flows/__tests__/build.flow.test.ts` | `respects shouldStop() between waves and sets stoppedReason='user_stop'` (the `cost_capped` composite shares this guard path; a `budget_exceeded` stop reason flows through the same guard) |
| 12 | `npm run check` green at every phase exit | `.ridgeline/builds/fascicle-migration/phase-<N>-check.json` artefacts | each artefact records the verbatim `.check/summary.json` snapshot at its phase's exit commit; top-level `ok: true` and all eight sub-checks `ok: true` is the asserted shape |

## Notes

- Tests under `src/__tests__/`, `src/engine/__tests__/`,
  `src/engine/{atoms,composites,flows,adapters}/__tests__/`, and
  `src/stores/__tests__/` are exercised by `npm run check` (the `test`
  step runs vitest under the project default config). The list above is
  the regression net for the twelve invariants; failures must surface
  as red `it(...)` cases, not silent drift.
- `phase-<N>-check.json` artefacts live alongside this file.
  Phase 12's exit gate is the addition of the per-phase artefact for
  this phase plus the rules + tests + docs in this PR.
- The byte-equality of `tsc --emitDeclarationOnly` output is asserted
  by `src/__tests__/cli.dts.snapshot.test.ts` (one case per subcommand)
  — not strictly one of the twelve §7 invariants but serves the same
  preservation contract for `src/commands/*.ts` external signatures.
- Commander option-set byte equality is asserted by
  `src/__tests__/cli.options.snapshot.test.ts` (one case per command)
  — also a preservation contract for the CLI flag set (invariant 1).
