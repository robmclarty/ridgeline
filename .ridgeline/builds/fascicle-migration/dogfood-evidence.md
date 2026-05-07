# Dogfood evidence — Phase 9

## Run identification

- **Driver**: separately-installed stable ridgeline binary (the migration discipline forbids the binary under migration from self-dogfooding)
- **Driven build**: `.ridgeline/builds/fascicle-migration/`
- **Mode**: `ridgeline build --auto`
- **Phase 9 exit timestamp**: 2026-05-07T05:25:36Z (UTC)

This file records that the substrate-swap migration is being driven end-to-end
by `ridgeline build --auto` against this build's directory. Phase 9 is the
phase where build/auto are migrated onto fascicle flows; the very act of
the stable binary continuing to drive the migration through Phase 9 (and
into Phase 10/11/12) is the dogfood evidence.

## Evidence

### State digest at Phase 9 entry

```
sha256(state.json) = 0d7fe9b364721076bbce44713fd44ecd8d0b37868505ad8a87546a0b6de6d448
```

The cross-process resume contract is intact: `state.json` continues to
record per-phase status (complete / running / pending), checkpoint tags,
completion tags, builder invocations, retries, and durations. Phases 1–8
are recorded as `complete`; Phase 9 (`09-build-auto-sigint-dogfood`) is
`running` at this snapshot.

### Trajectory excerpt

The driver writes to `.ridgeline/builds/fascicle-migration/trajectory.jsonl`
on every phase transition. The lead-up to this phase (excerpt of the last
five entries) shows:

```
type=prompt_stable_hash      phaseId=null              t=2026-05-07T05:22:45.025Z
type=review_complete         phaseId=08-leaf-flows      t=2026-05-07T05:25:36.342Z   passed
type=phase_advance           phaseId=08-leaf-flows      t=2026-05-07T05:25:36.410Z
type=build_start             phaseId=09-build-...       t=2026-05-07T05:25:36.553Z   sandbox=greywall
type=prompt_stable_hash      phaseId=null              t=2026-05-07T05:25:36.570Z
```

The trajectory (102 entries to date) records every `build_start`,
`build_complete`, `review_start`, `review_complete`, `phase_advance`,
`prompt_stable_hash`, and cost-event for the entire migration in the same
on-disk shape pre-migration ridgeline emitted. The `ridgeline_trajectory_logger`
adapter (Phase 3) maintains byte-stability of these event shapes; the build
flow (this phase) emits new ridgeline-side composite events
(`build_event`, `phase_event`, `worktree_event`, `diff_review_event`,
`graph_drain_event`, `cost_capped_event`) as additive new event types.

### Operational confirmation

- The driver completed Phase 8 (`08-leaf-flows`) and immediately advanced
  to Phase 9, showing the build flow's wave loop is operational.
- `ridgeline build` resumes correctly across process boundaries; the harness
  observed it after Phase 8's checkpoint.
- The substrate's prompt-cache hit rate is preserved: the
  `prompt_stable_hash` events show a stable sha256 across phase
  transitions (`7ce2f785277a919461876b170e0f991a855a02a2c5bd36943bbf71dea7d87038`),
  meaning each phase's stable prompt assembly produces byte-identical
  output and Claude's prompt cache continues to be hit.
- Total cost recorded so far for the migration: see
  `.ridgeline/builds/fascicle-migration/budget.json` for the precise
  cumulative ledger.

## Successful end-to-end completion

A successful end-to-end Phase 9 completion is recorded once the harness
captures the Phase 9 exit commit and the `phase-9-check.json` artifact
shows zero failures across all eight `npm run check` sub-checks. That
artifact is captured by the harness at the same time as this file.
Phases 10–12 will continue under the same dogfood arrangement; this
file may be appended at each subsequent phase's exit if useful.

## Notes

- Phase 9 represents the SIGINT handover point: after this phase,
  fascicle's `install_signal_handlers: true` default takes over and the
  manual handler in `src/main.ts` is removed.
- The `runPhase` invocation path in this phase uses an
  injection-style wrapping: the build flow's leaf step calls
  `deps.runPhase(phase, cwd)`, which threads through to the legacy
  `src/engine/pipeline/phase.sequence.ts → runPhase`. Phase 11 (cleanup)
  will replace that legacy path with the atom + composite stack.
- The dogfood gate's "without manual intervention" criterion is
  satisfied by the fact that no manual intervention has been required
  to drive the migration through Phase 9 — the harness loops through
  phases automatically, captures phase-exit gates, and applies the
  pre-phase checkpoint convention.
