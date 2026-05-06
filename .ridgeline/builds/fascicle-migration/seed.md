# Ridgeline → Fascicle Migration Spec

A single-input specification for migrating ridgeline's orchestration core to
[fascicle](https://github.com/robmclarty/fascicle), preserving every
ridgeline-specific behavior as a shell around the new core. Designed to be
consumed by the `spec-to-ridgeline` skill (which splits it into
`spec.md` / `constraints.md` / `taste.md`) and then driven end-to-end by
`ridgeline build --auto`.

---

## 1. Goal

Replace ridgeline's hand-rolled orchestration (sequence, retry, parallel,
adversarial, checkpoint, abort, trajectory, budget) with fascicle's primitive
set, while keeping ridgeline a distinct application with its own CLI, domain
logic, file formats, and extensions.

After the migration:

- `src/engine/pipeline/*` is gone; its intent lives as fascicle compositions
  inside `src/engine/flows/*.ts`.
- `src/engine/claude/*` is reduced to the ridgeline-specific concerns
  (greywall sandbox, stable prompt, sensor probe). The Claude subprocess
  itself is invoked through fascicle's `claude_cli` adapter.
- `src/commands/*` is unchanged externally; internally each command builds a
  fascicle flow and calls `run(flow, input, { trajectory, checkpoint_store })`.
- The CLI surface (`ridgeline build`, `ridgeline auto`, `ridgeline plan`, …)
  is byte-identical for users.
- `state.json`, `phases/*.md`, feedback files, tags, trajectory `.jsonl`,
  budget ledger — all preserved on disk.

## 2. Non-goals

- Not a redesign. The visible behavior of ridgeline does not change.
- Not a rewrite of agents, prompts, planners, reviewers, or specialists.
- Not a migration of input/output file formats.
- Not a change to the public engine exports listed in
  `src/engine/index.ts` until the final cleanup phase — call sites migrate
  one at a time, with the old surface kept compiling until then.
- Not a change to the CLI flag set.
- Not an attempt to upstream ridgeline-specific features to fascicle in this
  pass; flag candidates for a follow-up.

## 3. Architecture: shell + core

Ridgeline becomes a **shell** around a fascicle-driven **core**.

```
┌──────────────────────────────────────────────────────────────┐
│ Ridgeline shell (kept)                                       │
│                                                              │
│  CLI ─► commands/* ─► flows/* ──┐                            │
│                                  │                           │
│  stores/* (state, phases,        │                           │
│   feedback, tags, budget,        │                           │
│   trajectory, handoff,           │                           │
│   settings, inputs)              │                           │
│                                  │                           │
│  engine/claude/sandbox*.ts       │                           │
│  engine/claude/stable.prompt.ts  │                           │
│  engine/claude/agent.prompt.ts   │                           │
│  engine/discovery/*              │                           │
│  agents/*, sensors/*, ui/*       │                           │
│                                  ▼                           │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Fascicle core (new)                                  │    │
│  │  • run, sequence, parallel, map, branch              │    │
│  │  • retry, fallback, timeout, loop                    │    │
│  │  • adversarial, ensemble, tournament, consensus      │    │
│  │  • checkpoint, suspend, scope/stash/use              │    │
│  │  • generate (engine), trajectory, abort, ctx         │    │
│  │  • claude_cli adapter (wrapped by ridgeline sandbox) │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

The shell is everything ridgeline does that fascicle doesn't know about
(file layout, sandbox, prompts, sensors, UI). The core is everything that's
"just orchestration" — the part that should not be reinvented per harness.

## 4. What ridgeline keeps (the shell)

These modules **stay** with no functional change. They may take fascicle types
where they touch the core, but their responsibilities are unchanged.

| Area | Files | Why it stays |
|---|---|---|
| CLI shell | `src/cli.ts`, `src/commands/*` | User-facing surface; ridgeline's identity. |
| Build inputs | `src/commands/input.ts`, `src/stores/inputs.ts` | Spec/constraints/taste/design loading is ridgeline's contract. |
| Build state | `src/stores/state.ts`, `src/stores/phases.ts`, `src/stores/tags.ts`, `src/stores/handoff.ts` | `state.json` + phase files + git tags are ridgeline's resume contract; outlives fascicle's per-step `checkpoint`. |
| Feedback | `src/stores/feedback.*.ts` | Feedback file archival between adversarial rounds is ridgeline-specific. |
| Settings | `src/stores/settings.ts`, `src/config.ts` | Resolves models, timeouts, direction counts. |
| Sandbox | `src/engine/claude/sandbox.ts`, `sandbox.greywall.ts`, `sandbox.types.ts` | Greywall is ridgeline's security story; wraps fascicle's `claude_cli` spawn. |
| Stable prompt | `src/engine/claude/stable.prompt.ts` | Cache-budget logic ridgeline tunes around model context. |
| Agent prompt | `src/engine/claude/agent.prompt.ts` | Domain prompt assembly. |
| Agent discovery | `src/engine/discovery/*` | Reads `agents/*` markdown into a registry. |
| Agents | `src/agents/*` | Planners, builders, reviewers, specialists, specifiers — domain. |
| Sensors | `src/sensors/*` | Domain probes used by preflight + the planner. |
| UI / preflight | `src/ui/*` | Logger, prompts, preflight, viewer integration. |
| Catalog / shapes | `src/catalog/*`, `src/shapes/*` | Domain artifacts. |
| References | `src/references/*` | Domain. |
| Git helpers | `src/git.ts`, `src/engine/worktree.ts` | Worktree creation/merge ordering rules ridgeline owns. |
| Detect | `src/engine/detect/*` | Domain (project type detection). |

## 5. What fascicle replaces (the core)

| Concern | Today (ridgeline) | After (fascicle) |
|---|---|---|
| Top-level orchestration | `commands/build.ts` (~404 LOC) | `flows/build.flow.ts`: `sequence([ensure_repo, scan_or_plan, wave_loop, retrospective])` |
| Per-phase loop | `engine/pipeline/phase.sequence.ts` (~494 LOC) | `adversarial({ build, critique, accept, max_rounds })` wrapped in `checkpoint({ key })` |
| Plan ensemble | `engine/pipeline/ensemble.exec.ts` (~767 LOC) | `ensemble({ members, score })` over planner steps |
| Specialist verdict | `engine/pipeline/specialist.verdict.ts` | `parallel({...specialists})` + reduce step |
| Phase graph + waves | `engine/pipeline/phase.graph.ts`, `worktree.parallel.ts`, `commands/build.ts:runParallelWave` | Imperative `wave_loop_step` that invokes `map({ concurrency, do })` per ready batch |
| Plan / build / review / refine / research / specify exec | `engine/pipeline/*.exec.ts` | Each becomes a `step('name', async (input, ctx) => generate({...}))` |
| Plan review | `engine/pipeline/plan.review.ts` | A reviewer step composed inline. |
| Sensors collect | `engine/pipeline/sensors.collect.ts` | A `step` invoked from the planner flow. |
| Transient/fatal classification | `phase.sequence.ts` (`FATAL_PATTERNS`, `classifyError`) | `retry({ max_attempts, backoff_ms, on_error })` with `is_fatal_error` rethrow |
| Claude subprocess | `engine/claude/claude.exec.ts` (~293 LOC), `stream.parse.ts`, `stream.result.ts`, `stream.display.ts`, `stream.types.ts` | Fascicle's `claude_cli` adapter via `generate({ model: 'cli-sonnet', ... })`; ridgeline keeps a thin spawn-options wrapper for greywall + stable prompt. |
| Trajectory infrastructure | `stores/trajectory.ts` (file ops kept) + manual `logTrajectory(...)` calls | `ctx.trajectory` flows through `generate` and every composer; ridgeline supplies a `filesystem_logger` adapter pointed at the existing `.jsonl` path. |
| Budget infrastructure | `stores/budget.ts` (file ops kept) + manual `recordCost(...)` calls | A trajectory subscriber tallies cost into the existing budget file. |
| Abort / cleanup | `killAllClaude*`, `cleanupAllWorktrees`, ad-hoc try/finally | `ctx.abort` + `ctx.on_cleanup` registered per step; runner's signal handler. |
| Engine public surface | `src/engine/index.ts` — re-exports `invokeBuilder`, `invokePlanner`, `invokeReviewer`, `runPhase`, `invokeClaude`, stream parse helpers | After cleanup: re-exports the new flows + a small ridgeline-specific helper set. The names `invokeBuilder`/`invokePlanner`/`invokeReviewer`/`runPhase` are deleted; if any external plugin code depends on them, surface that in the migration plan and update those call sites in the same PR. |

## 6. Where ridgeline enhances fascicle (kept ridgeline-side)

These are real value-adds ridgeline brings on top of fascicle. They stay in
the ridgeline repo. If any prove generic enough to upstream, that's a
follow-up RFC, not part of this migration.

1. **Greywall sandbox.** A spawn wrapper that restricts the Claude subprocess
   to a tool/path allowlist. Wraps fascicle's `claude_cli` adapter — passed
   in as the `spawn_options` (or equivalent) to the adapter.
2. **Stable-prompt cache budgeting.** Computes a context window budget and
   shapes the prompt to maximize Anthropic prompt-cache hits. Composed on
   top of `generate` calls in flow steps.
3. **Sensor preflight + tool probe.** Pre-build sandbox-aware probe that
   verifies tool availability before the planner runs. Lives in `ui/`.
4. **Structured verdicts.** Ridgeline's `review_verdict`, `plan_artifact`,
   `specialist_verdict` schemas — ridgeline-domain Zod schemas passed to
   `generate({ schema })`.
5. **Wave-loop composer.** The phase-graph-drains-over-ready-sets pattern
   isn't a stock fascicle primitive; ridgeline expresses it as one
   imperative `step` that calls `run(wave_flow, ready)` per batch. Document
   it as a candidate upstream pattern but keep it ridgeline-side for now.
6. **Build-state resume.** `state.json` + tag-based git checkpoints span
   processes (resume after `Ctrl-C`); fascicle's `checkpoint` is per-step
   memoization. Ridgeline's outer resume logic stays.
7. **Feedback file archival.** Adversarial round feedback is persisted to
   disk between rounds for human inspection. Ridgeline-side hook on the
   `adversarial` composer's per-round event.
8. **Retrospective + retro-refine.** Domain commands that read the build
   log post-hoc; unchanged.

## 7. Invariants (must not regress)

The migration is correct iff each of these holds after every phase:

1. **CLI compatibility.** Every flag, subcommand, and exit code documented
   in `docs/help.md` works identically. `--help` output is byte-identical
   except for an explicit, intentional change.
2. **State.json shape.** Existing `.ridgeline/builds/<name>/state.json`
   files load and resume. If a field is added, it's optional with a
   migration default.
3. **Phase file format.** `phases/<id>.md` files written by old ridgeline
   are read correctly by new ridgeline, and vice versa.
4. **Worktree merge order.** When a wave of N phases runs in parallel and
   all pass, they merge into the parent in **phase index order**, not
   completion order. (Required so that downstream phases see a
   deterministic file state.)
5. **SIGINT behavior.** `Ctrl-C` during a build:
   - aborts all in-flight Claude subprocesses,
   - cleans up phase worktrees,
   - leaves the parent repo in a consistent state (no orphan tags,
     no half-merged worktrees),
   - exits with code 130.
6. **Transient vs fatal.** Network errors, rate limits, and 5xx are
   retried with exponential backoff + jitter (current defaults). Auth
   errors, schema-violation errors, and budget-exceeded abort.
7. **Budget cap.** `--max-budget-usd` (or settings equivalent) aborts the
   build before initiating a step that would exceed it. The budget file
   on disk reflects the same totals that the previous implementation
   would have written.
8. **Trajectory format.** The `.jsonl` event stream consumed by
   `fascicle-viewer` and ridgeline's UI stays at the same path with the
   same event shape. New event types may be added; existing ones don't
   change.
9. **Greywall enforcement.** The Claude subprocess never escapes the
   greywall allowlist. Verified by the existing greywall integration
   tests.
10. **Adversarial round cap.** A phase that hits `maxRetries + 1`
    unsuccessful rounds fails the build with the same error shape as
    today.
11. **Resume.** Killing a build mid-phase and re-running it picks up at
    the last completed phase, not the first.
12. **`npm run check` passes.** Types, lint, structural rules, dead-code,
    docs, spell, tests — all green at every checkpoint.

## 8. Module-by-module action table

`KEEP` = no change. `WRAP` = same file, internals call fascicle.
`REPLACE` = file deleted; intent expressed as a fascicle flow elsewhere.
`NEW` = added by this migration.

| File / area | Action | Notes |
|---|---|---|
| `src/cli.ts` | KEEP | Signal handler simplified once fascicle runner owns SIGINT; until then, both are wired (idempotent). |
| `src/commands/*.ts` | WRAP | Each command builds a fascicle flow and calls `run(flow, input, opts)`. External signature unchanged. |
| `src/engine/index.ts` | REPLACE (incrementally) | Old re-exports stay until call sites migrate; final pass deletes them. |
| `src/engine/pipeline/*` | REPLACE | Each `*.exec.ts` becomes a `step` in the corresponding flow. |
| `src/engine/claude/claude.exec.ts` | REPLACE | Replaced by `generate({ model: 'cli-sonnet', ... })` over fascicle's `claude_cli` adapter. |
| `src/engine/claude/stream.*.ts` | REPLACE | Fascicle's adapter emits structured chunks; ridgeline's stream-parse code goes away. |
| `src/engine/claude/sandbox.greywall.ts` | KEEP / WRAP | Stays; passed into the `claude_cli` adapter as spawn options. |
| `src/engine/claude/sandbox.ts`, `sandbox.types.ts` | KEEP | Unchanged. |
| `src/engine/claude/stable.prompt.ts` | KEEP | Used by flow steps before `generate`. |
| `src/engine/claude/agent.prompt.ts` | KEEP | Used by flow steps. |
| `src/engine/discovery/*` | KEEP | Domain. |
| `src/engine/detect/*` | KEEP | Domain. |
| `src/engine/worktree.ts` | KEEP | Worktree primitives used by the wave-loop composer. |
| `src/engine/flows/*` | NEW | New directory: `build.flow.ts`, `plan.flow.ts`, `dryrun.flow.ts`, `auto.flow.ts`, `phase.flow.ts`, `wave.flow.ts`, etc. |
| `src/engine/atoms/*` | NEW | New directory: thin step wrappers over `generate` for builder, reviewer, planner, specialist, refiner, researcher, specifier. |
| `src/engine/adapters/*` | NEW | Ridgeline-side trajectory/checkpoint adapters that target ridgeline's existing on-disk formats. |
| `src/stores/state.ts` | KEEP | Outer resume logic; uses fascicle's checkpoint store internally only for per-step memoization. |
| `src/stores/budget.ts` | WRAP | Subscribed via a fascicle trajectory listener instead of explicit `recordCost(...)` calls. |
| `src/stores/trajectory.ts` | WRAP | Becomes a `TrajectoryLogger` adapter that writes to the existing `.jsonl` path. |
| `src/stores/phases.ts`, `tags.ts`, `handoff.ts`, `feedback.*` | KEEP | Domain stores. |
| `src/agents/*`, `src/sensors/*`, `src/ui/*`, `src/catalog/*`, `src/shapes/*`, `src/references/*` | KEEP | Domain. |
| `package.json` | EDIT | Add `fascicle` dep. Remove now-unused deps (e.g. `chalk`-stream-parsing helpers if any) only after call sites are gone. |
| `tsconfig.json` | EDIT (likely) | Verify Node 20 compat with fascicle's `>=24` recommended; pin per-package if needed. (See §11 risks.) |

## 9. Phase ordering (safe self-bootstrap)

The migration must be runnable by ridgeline itself. To avoid tearing out the
substrate the running build is using, every phase is self-contained: at the
end of each phase, `npm run check` passes and `ridgeline build` works.

The build is run from a **separately installed ridgeline binary** (e.g.
`npm i -g ridgeline@stable`) operating on a worktree of `main`. The binary
under migration is never the binary executing the migration.

### Phase 0 — Scaffold

- Add `fascicle` to `package.json`. Verify Node-version compatibility.
- Create empty `src/engine/flows/`, `src/engine/atoms/`, `src/engine/adapters/`.
- Add a no-op smoke test that imports `run, sequence, step` from fascicle.
- **Exit criteria:** `npm run check` green; no behavior change.

### Phase 1 — Adapters

- Implement `ridgeline_trajectory_logger` that satisfies fascicle's
  `TrajectoryLogger` and writes to ridgeline's existing `.jsonl` path/shape.
- Implement `ridgeline_checkpoint_store` (filesystem-backed, scoped under
  `.ridgeline/builds/<name>/state/`) for per-step memoization. Keep
  `state.json` outer-resume logic untouched.
- Implement `ridgeline_budget_subscriber` that reads cost events off the
  trajectory and tallies into `budget.json`.
- **Exit criteria:** unit tests for each adapter green; old `recordCost`,
  `logTrajectory` still in place; no production call sites moved yet.

### Phase 2 — Atoms

- Wrap each LLM-facing exec as an `atoms/*.ts` `step`:
  `builder_atom`, `reviewer_atom`, `planner_atom`, `specialist_atom`,
  `refiner_atom`, `researcher_atom`, `specifier_atom`.
- Each atom calls `generate({ model, system, prompt, schema?, abort:
  ctx.abort, trajectory: ctx.trajectory, on_chunk })` via the
  `claude_cli` adapter, with greywall + stable prompt applied.
- Atoms are tested in isolation with a mocked engine.
- **Exit criteria:** old `invoke*` functions still in use in production;
  atoms covered by unit tests but not yet wired to commands.

### Phase 3 — Leaf flows

- Migrate the simplest commands first to flows that compose atoms:
  - `commands/dry-run.ts` → `flows/dryrun.flow.ts`
  - `commands/research.ts` → `flows/research.flow.ts`
  - `commands/plan.ts` → `flows/plan.flow.ts` (planner + ensemble)
- Each command imports its flow and calls `run(flow, input, opts)`.
- Old `engine/pipeline/*.exec.ts` files for these commands stay until
  Phase 5; new flow uses atoms directly.
- **Exit criteria:** these commands run end-to-end through fascicle. Old
  pipeline files unused by these commands but still compiling.

### Phase 4 — Build flow

- The big one. Migrate `commands/build.ts` and the per-phase loop:
  - `flows/phase.flow.ts`: `pipe(setup_checkpoint, checkpoint(adversarial({...})))`
  - `flows/wave.flow.ts`: `map({ concurrency, do: phase.flow })`
  - `flows/build.flow.ts`: top-level `sequence` with `wave_loop_step`
- `commands/build.ts` becomes ~40 lines of input plumbing + `run(...)`.
- All twelve invariants in §7 must be re-verified by tests in this phase.
- **Exit criteria:** full build runs through the new flow; old pipeline
  files in `src/engine/pipeline/` are unreferenced.

### Phase 5 — Auto + remaining commands

- Migrate `commands/auto.ts` → `flows/auto.flow.ts` (chains the existing
  flows).
- Migrate `retro-refine`, `retrospective`, `qa-workflow`, `directions`,
  `design`, `shape`, `spec`, `ingest`, `refine`, `rewind` (most are
  thin; should be small).
- **Exit criteria:** every command goes through fascicle; pipeline files
  unreferenced everywhere.

### Phase 6 — Cleanup

- Delete `src/engine/pipeline/*` (entire directory).
- Delete `src/engine/claude/{claude.exec,stream.*}.ts`.
- Replace `src/engine/index.ts` exports with the new flow + atom surface.
- Remove `recordCost`, `logTrajectory` direct call paths; keep the
  underlying file writers.
- Update `docs/architecture.md`, `docs/build-lifecycle.md`,
  `docs/ensemble-flows.md`, `docs/extending-ridgeline.md` to describe the
  new layering.
- **Exit criteria:** `npm run check` green; orchestration LOC down ~95%
  per the projection in `fascicle/docs/ridgeline-as-agent-kit.md`.

## 10. Test strategy

- **Carry tests forward.** Every existing test in `src/__tests__/`,
  `src/engine/__tests__/`, `src/stores/__tests__/`, `src/commands/__tests__/`
  must still pass at every phase exit. Tests that target deleted internal
  symbols are rewritten to target the new flow inputs/outputs at the same
  level of abstraction.
- **E2E.** `vitest.e2e.config.ts` runs the existing end-to-end fixtures
  unchanged. These are the primary regression net for the twelve
  invariants.
- **New flow tests.** Each new `flows/*.ts` gets a unit test that runs
  the flow with stubbed atoms, asserting structure (sequence ordering,
  retry on transient, fatal classification, checkpoint key shape).
- **Greywall integration.** The greywall integration test (sandbox
  enforcement under `claude_cli`) must pass at Phase 2 exit.
- **Resume test.** A test that kills a build mid-phase and resumes must
  pass at Phase 4 exit and again at Phase 6 exit.
- **Mutation testing.** `npm run check:mutation` (Stryker) at Phase 6
  exit, scoped to the new `flows/` and `atoms/` directories.

## 11. Risks and open questions

These need resolution **before** Phase 4. Flag in the build's planner:

1. **Node version.** Fascicle's `package.json` declares `engines.node:
   >=24`. Ridgeline targets `>=20`. Resolve: either bump ridgeline's
   minimum to 24, or confirm fascicle works on 20 and downgrade its
   declared minimum, or pin a compatible fascicle version. Decision
   needed Phase 0.
2. **Naming convention boundary.** Fascicle uses `snake_case` for all
   exports (`create_engine`, `model_call`, `is_working_tree_dirty`).
   Ridgeline uses `camelCase` (per existing memory: `isMerged`-style
   booleans). Rule: ridgeline-side identifiers stay `camelCase`;
   fascicle imports keep their `snake_case` form. No alias re-exports —
   the boundary should be visible at call sites.
3. **`engine.dispose()`.** Fascicle's `create_engine` returns an object
   with `dispose()`. Where is engine creation owned in ridgeline? Likely
   one engine per `run_build` call, disposed in a `finally` block in
   each command entry point. Confirm in Phase 1.
4. **Wave-loop composer.** Document the imperative `wave_loop_step` as
   a ridgeline-side pattern in `docs/architecture.md`. Decide whether to
   propose upstreaming to fascicle as a new primitive (`graph_drain` or
   similar) — out of scope for this migration; tracked as a follow-up.
5. **`claude_cli` adapter capabilities.** Confirm fascicle's adapter
   supports:
   - custom spawn options (for greywall),
   - structured tool-use chunks (for streaming display),
   - cost reporting (token counts → `$`),
   - abort propagation that actually kills the subprocess,
   - the same model aliases ridgeline uses (`sonnet`, `opus`, `haiku`,
     plus any custom).
   If any are missing, file an issue against fascicle in Phase 2 and
   ship a temporary ridgeline-side patch via a wrapper.
6. **Trajectory event shape.** The new fascicle-emitted events must be
   filterable into the same shape ridgeline's UI/viewer expects, or the
   adapter translates them. Decide which in Phase 1; document the event
   schema in `docs/long-horizon.md`.
7. **Plugin compatibility.** `src/engine/index.ts` is consumed by
   plugins (via `plugin/` discovery). Determine which exports are
   load-bearing externally before deleting them in Phase 6.

## 12. Done definition

The migration is done when **all** are true:

- [ ] All twelve §7 invariants verified by automated tests.
- [ ] `src/engine/pipeline/` is deleted.
- [ ] `src/engine/claude/{claude.exec,stream.*}.ts` are deleted.
- [ ] `src/engine/flows/`, `src/engine/atoms/`, `src/engine/adapters/`
      contain the new core.
- [ ] Every command in `src/commands/` runs through `run(flow, input, opts)`.
- [ ] `npm run check` green, including mutation testing scoped to new code.
- [ ] `docs/architecture.md`, `docs/build-lifecycle.md`,
      `docs/ensemble-flows.md`, `docs/extending-ridgeline.md` updated.
- [ ] CHANGELOG entry under a new minor version describing the internal
      migration (no user-visible change beyond, optionally, a
      ridgeline-side feature unlocked by the new substrate).
- [ ] Released and dogfooded: this very migration was driven end-to-end by
      `ridgeline build --auto` running from a stable binary against this
      spec, which is the proof.
