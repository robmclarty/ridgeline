## Phase 5: Tier 1 composites

### What was built

Five Tier 1 composites under `src/engine/composites/`, each implementing
fascicle's `Step<i, o>` contract via `compose(name, step(id, fn))` so
trajectory spans surface under the composite's display name. Plus a
barrel `index.ts` and a 25-test suite under
`src/engine/composites/__tests__/`.

- `phase.ts` — build/review retry loop with optional `archive_feedback`
  slot. Throws `Error("Retries exhausted")` after `max_retries + 1`
  unsuccessful rounds, matching `baseline/fixtures/error-shapes.json`
  `adversarial_round_cap_exhaustion.trajectory_event.message`.
- `graph_drain.ts` — bounded-concurrency drain over an array of inputs
  through a single inner Step. Tagged as upstream-RFC candidate.
- `worktree_isolated.ts` — N inner phases run via a stub-friendly
  `WorktreeDriver` (create/merge/remove). `merge_back` defaults to
  `'index_order'`; `'completion_order'` available. Cleanup registers
  worktree removal on success/failure/abort via `ctx.on_cleanup`.
- `diff_review.ts` — sequence wrapper around build → commit → diff →
  review with a span-ordered trajectory event sequence.
- `cost_capped.ts` — wraps an inner step with a child `AbortController`
  composed against the parent `ctx.abort` via `AbortSignal.any`. A
  caller-supplied `subscribe` listener accumulates cost and aborts the
  child once cumulative ≥ `max_usd`. Tagged as upstream-RFC candidate
  with a top-of-file race-semantics comment ("cumulative budget can be
  exceeded by at most one in-flight step").

Test coverage: 5 files, 25 tests total; each composite has at least four
`it(...)` blocks covering abort-within-100ms, trajectory span emission,
`ctx.on_cleanup` firing on success+failure+abort, and stable error
surfacing.

### Decisions

- **`step(id, fn)` + `compose(name, inner)` pattern.** Fascicle's
  `describe` is an introspection function (returns a string), not a
  decorator. The constraints/spec text saying "decorated via
  `describe('<name>')`" maps onto fascicle's actual naming primitive,
  which is `compose(name, inner)` — this sets `config.display_name` so
  the dispatcher emits a span under that label. Each composite returns
  `compose(name, step('<name>_inner', fn))`.
- **`phase.archive_feedback` slot, not `adversarial_archived`
  decorator.** Per taste.md ("Pick `phase`'s `archive_feedback` slot OR
  `adversarial_archived` as a Tier 2 decorator — not both"), and
  because `adversarial_archived` is a Tier 2 candidate, the slot path
  was chosen. Documented in a single-line top-of-file comment.
- **Custom step bodies, not built-in `sequence`/`map` composition.**
  Each composite's behavior (cleanup registration, abort propagation,
  trajectory event emission with composite-specific kinds) requires
  control fascicle's primitives don't expose declaratively. Building
  on `step()` lets composites emit ridgeline-side trajectory events
  (camelCase: `phase_event`, `cost_capped_event`, etc.) alongside
  fascicle's snake_case `span_start`/`span_end`.
- **`cost_capped.subscribe` callback, not implicit ctx.trajectory
  filter.** Cost events come from `model_call`-emitted GenerateResult
  cost data, not from the trajectory stream. Making the subscription
  explicit keeps the composite testable with synthetic emitters and
  avoids coupling cost wiring to a particular trajectory adapter.
- **`worktree_isolated` accepts a `WorktreeDriver`, not direct git
  calls.** This phase has no production wiring (per criterion 13,
  composites aren't consumed yet). The driver interface lets the unit
  test inject a stub git driver without spawning real `git worktree
  add`. Production-time the driver will wrap `src/engine/worktree.ts`
  and the existing `worktree.parallel.ts` git invocations.
- **`flow.run(input, syntheticCtx)` for abort tests.** Fascicle's
  public `run()` doesn't accept an external AbortSignal — it only
  installs SIGINT/SIGTERM handlers. To drive abort tests deterministically
  the test calls `flow.run(input, ctx)` directly with a synthetic
  RunContext carrying an external `AbortSignal`. This bypasses the
  outer dispatcher's span emission for that one test, which is fine —
  the abort test only asserts inner abort propagation latency, not
  trajectory.

### Deviations

- **`Error` name vs `Error.name`.** The baseline fixture's
  `adversarial_round_cap_exhaustion.name` is the literal string
  `"Error"`. Pre-migration the code returned `"failed"` rather than
  throwing; the substrate swap requires throwing. The error thrown is
  `new Error("Retries exhausted")`, so `err.name === "Error"` and
  `err.message === "Retries exhausted"` (matching the fixture's
  `trajectory_event.message`). The thrown `.message` does not
  reproduce the stderr template text (`"[<phase-id>] FAILED: retries
  exhausted"`) — that's a stderr-side message, not the error's
  `.message` field. The runner / command-shell layer is where stderr
  templating belongs (added in Phase 8/9 when commands are migrated).

- **No production wiring of composites.** Per criterion 13 ("ridgeline
  build runs end-to-end on the old pipeline; composites are not yet
  consumed"), the new composites are pure additions. The build flow
  won't import them until Phase 8.

### Notes for next phase

- **Fascicle naming primitive.** When future composites/atoms need a
  named span, use `compose(name, inner)` not `step(id, fn)` alone —
  `compose` sets `config.display_name` which is what the dispatcher
  reads via `resolve_span_label`. A bare `step(id, fn)` emits a span
  with `name="step"` and the id in `meta.id` — readable in the
  trajectory but not the same as the composite's name.
- **`AbortSignal.any` is available.** Fascicle uses it internally
  (`timeout` composite) to compose parent + child abort. `cost_capped`
  uses the same pattern. New composites that need to abort *just* the
  inner step (without aborting the whole run) should use this same
  pattern: local AbortController + `AbortSignal.any([ctx.abort,
  local.signal])` + spread ctx with the composed signal.
- **Trajectory events for composites are camelCase keys**: e.g.,
  `phase_event`, `worktree_event`, `cost_capped_event`,
  `diff_review_event`, `graph_drain_event`. These are ridgeline-side
  emit payloads (delivered via `ctx.emit({ ... })`), so they appear in
  trajectory.jsonl with `kind: "emit"` and the camelCase fields. The
  span emitted by `compose` itself is fascicle's snake_case
  `kind: "span_start"` / `kind: "span_end"` — that's not changed.
- **Test pattern for composites.** The shared helper
  `src/engine/composites/__tests__/_helpers.ts` exports a
  `recordingTrajectory()` factory that returns `{ logger, events }`.
  Tests pass `logger` as the `trajectory` option to `run(...)` and
  assert against `events`. Reuse this helper in adjacent test
  directories (atoms, flows) when wiring the same patterns.
- **Old pipeline still operational.** No production caller uses the
  new composites; `src/engine/pipeline/*` is untouched and the
  binary builds and runs end-to-end. Phase 7's atoms work and Phase 8's
  flow migrations are next.
- **Environmental note (sandbox).** The agnix npm install
  postinstall fetches `agnix-binary` from GitHub (network blocked
  under greywall sandbox). Phase 5's check was greened by symlinking
  the binary from a sibling install: `ln -sf
  $REPO_ROOT/node_modules/agnix/bin/agnix-binary
  ./node_modules/agnix/bin/agnix-binary`. Future fresh worktrees
  under the same sandbox should expect the same workaround. The
  `phase-5-check.json` artifact captured at this commit shows all 8
  checks green (types, lint, struct, agents, dead, docs, spell,
  test).
- **Acceptance-criterion mapping (criterion → test):**
  - C1 (six-file layout): `ls src/engine/composites/`
  - C2 (Step + describe): every composite returns
    `compose(name, step(...))`
  - C3 (4 tests per composite): see `__tests__/<name>.test.ts`
  - C4 (round-cap fixture match): `phase.test.ts:
    "throws Error('Retries exhausted')..."`
  - C5 (slot xor decorator): `phase.ts` top-of-file comment +
    `archive_feedback` field on `PhaseConfig`
  - C6 (concurrency=2 with 4 ready): `graph_drain.test.ts:
    "respects concurrency=2..."`
  - C7 (merge in `[0,1,2]` for input `[2,0,1]`): `worktree_isolated.test.ts:
    "merges in index_order regardless of completion order..."`
  - C8 (cost cap race): `cost_capped.test.ts:
    "aborts the inner step on cumulative 0.50 + 0.45 + 0.10..."`
  - C9 (build→commit→diff→review order): `diff_review.test.ts:
    "preserves build → commit → diff → review trajectory event ordering"`
  - C10 (upstream-RFC tags): `graph_drain.ts` + `cost_capped.ts`
    top-of-file comments
  - C11 (no forbidden imports): `grep -rE 'pipeline/|claude/(claude\.exec|stream\.)'`
    in `src/engine/composites/` returns no matches
  - C12 (`npm run check` zero): see
    `.ridgeline/builds/fascicle-migration/phase-5-check.json`
  - C13 (build runs end-to-end): `npm run build && node dist/cli.js
    --help` exits 0
  - C14 (phase-5-check.json captured): see file at expected path
