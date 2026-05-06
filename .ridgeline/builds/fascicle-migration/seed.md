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
  (greywall sandbox **policy**, stable prompt, sensor probe). The Claude
  subprocess itself is owned by fascicle's `claude_cli` provider, which
  ships greywall as a built-in sandbox kind.
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
│  │  • model_call (engine), trajectory, abort, ctx       │    │
│  │  • claude_cli provider (greywall sandbox built-in)   │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  Ridgeline composites (Step<i,o> → Step<i,o>, §6.1):         │
│    phase · graph_drain · worktree_isolated ·                 │
│    diff_review · cost_capped                                 │
└──────────────────────────────────────────────────────────────┘
```

The shell is everything ridgeline does that fascicle doesn't know about
(file layout, sandbox policy, prompts, sensors, UI). The core is everything
that's "just orchestration" — the part that should not be reinvented per
harness.

### 3.1 Fascicle API surface (reference)

The exports the migration relies on, all from `fascicle` (npm) unless
noted. Fascicle is `snake_case` throughout:

- **Composition primitives** (from `fascicle`):
  `step`, `sequence`, `parallel`, `branch`, `map`, `pipe`, `retry`,
  `fallback`, `timeout`, `loop`, `compose`, `checkpoint`, `suspend`,
  `scope`, `stash`, `use`, `describe`.
- **Composites** (from `fascicle`):
  `adversarial`, `ensemble`, `ensemble_step`, `consensus`, `tournament`,
  `improve`, `learn`, `bench`, `judge_equals`, `judge_llm`, `judge_with`.
- **Engine** (from `fascicle`):
  `create_engine`, `model_call`, `forward_standard_env`. Types:
  `Engine`, `EngineConfig`, `GenerateResult`, `Tool`, `StreamChunk`,
  `RetryPolicy`, `EffortLevel`, `Message`, `UsageTotals`.
- **Errors** (from `fascicle`):
  `aborted_error`, `engine_config_error`, `model_not_found_error`,
  `provider_error`, `provider_capability_error`,
  `provider_not_configured_error`, `rate_limit_error`,
  `schema_validation_error`, `tool_error`, `tool_approval_denied_error`,
  `on_chunk_error`. Use these via `instanceof` to replace ridgeline's
  current regex-based error classification.
- **Runner** (from `fascicle`):
  `run(flow, input, { trajectory?, checkpoint_store?, install_signal_handlers?, resume_data? })`,
  `run.stream(flow, input, opts)` for incremental events.
- **Adapters** (from `fascicle/adapters`):
  `filesystem_logger`, `http_logger`, `noop_logger`, `tee_logger`,
  `filesystem_store`. Contracts (`TrajectoryLogger`, `CheckpointStore`)
  exported from `fascicle` root for ridgeline's custom adapters.
- **Viewer** (from `fascicle`):
  `start_viewer`, `run_viewer_cli` — for the long-running observability
  dashboard. `fascicle-viewer` is also available as a `bin`.

### 3.2 Canonical call shape

```ts
import { create_engine, model_call, run, sequence, step, pipe } from 'fascicle'

const engine = create_engine({
  providers: {
    claude_cli: {
      auth_mode: 'auto',
      sandbox: { kind: 'greywall', network_allowlist: [...], additional_write_paths: [...] },
      plugin_dirs: [...],
      setting_sources: ['project', 'local'],
    },
  },
  defaults: { model: 'cli-sonnet' },
})

const builderAtom = pipe(
  step('shapeBuilderInput', (args: BuilderArgs) => buildBuilderPrompt(args)),
  model_call({ engine, system: BUILDER_SYSTEM, tools: BUILDER_TOOLS }),
)

try {
  const result = await run(builderFlow, input, {
    trajectory: ridgelineTrajectoryLogger(buildDir),
    checkpoint_store: ridgelineCheckpointStore(buildDir),
    // install_signal_handlers defaults to true
  })
} finally {
  await engine.dispose()
}
```

This is the only shape ridgeline needs to learn; every concrete atom and
flow is a variation on it.

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
| Sandbox policy | `src/engine/claude/sandbox.ts`, `sandbox.greywall.ts`, `sandbox.types.ts` | Ridgeline owns the *policy* (`--sandbox` flag mapping, default allowlists, per-build path resolution); fascicle's `claude_cli` provider owns the *mechanism* (`sandbox: { kind: 'greywall', ... }`). The greywall file is rewritten as a policy builder in Phase 1. |
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
| Top-level orchestration | `commands/build.ts` (~404 LOC) | `flows/build.flow.ts`: `cost_capped(sequence([ensure_repo, scan_or_plan, graph_drain({...}), retrospective]), { max_usd })` |
| Per-phase loop | `engine/pipeline/phase.sequence.ts` (~494 LOC) | `adversarial({ build, critique, accept, max_rounds })` wrapped in `checkpoint({ key })` |
| Plan ensemble | `engine/pipeline/ensemble.exec.ts` (~767 LOC) | `ensemble({ members, score })` over planner steps |
| Specialist verdict | `engine/pipeline/specialist.verdict.ts` | `parallel({...specialists})` + reduce step |
| Phase graph + waves | `engine/pipeline/phase.graph.ts`, `worktree.parallel.ts`, `commands/build.ts:runParallelWave` | `graph_drain({ nodes, deps_of, do: worktree_isolated({...}), concurrency, on_failure })` — see §6.1 |
| Plan / build / review / refine / research / specify exec | `engine/pipeline/*.exec.ts` | Each becomes a `Step` produced by `model_call({ engine, model, system, schema?, tools? })`, optionally wrapped with `pipe(prompt_step, model_call(...), (r) => r.content)`. |
| Plan review | `engine/pipeline/plan.review.ts` | A `model_call` step composed inline. |
| Sensors collect | `engine/pipeline/sensors.collect.ts` | A `step` invoked from the planner flow. |
| Transient/fatal classification | `phase.sequence.ts` (`FATAL_PATTERNS`, `classifyError`) | `retry({ max_attempts, backoff_ms, on_error })` with `instanceof` checks against fascicle's typed errors (`rate_limit_error`, `provider_error`, `engine_config_error`, `schema_validation_error`, etc.) replacing regex matching. |
| Claude subprocess | `engine/claude/claude.exec.ts` (~293 LOC), `stream.parse.ts`, `stream.result.ts`, `stream.display.ts`, `stream.types.ts` | Configured at `create_engine({ providers: { claude_cli: { auth_mode, sandbox: { kind: 'greywall', network_allowlist, additional_write_paths }, plugin_dirs, setting_sources, default_cwd, ... } } })`. Per-call `Step`s via `model_call({ engine, model: 'cli-sonnet', system, ... })`. **Greywall is first-class in fascicle's provider config** — ridgeline contributes the policy (allowlist), not the mechanism. |
| Trajectory infrastructure | `stores/trajectory.ts` (file ops kept) + manual `logTrajectory(...)` calls | `ctx.trajectory` flows through `model_call` and every composer. Ridgeline supplies a `TrajectoryLogger` adapter writing to the existing `.jsonl` path; optionally composed with fascicle's `tee_logger` to also drive `fascicle-viewer`. |
| Budget infrastructure | `stores/budget.ts` (file ops kept) + manual `recordCost(...)` calls | A `TrajectoryLogger` wrapper that intercepts cost events and tallies into ridgeline's existing budget file. Composed via `tee_logger`. |
| Abort / cleanup | `killAllClaude*`, `cleanupAllWorktrees`, ad-hoc try/finally | `ctx.abort` + `ctx.on_cleanup` registered per step; runner's signal handler. |
| Engine public surface | `src/engine/index.ts` — re-exports `invokeBuilder`, `invokePlanner`, `invokeReviewer`, `runPhase`, `invokeClaude`, stream parse helpers | After cleanup: re-exports the new flows + a small ridgeline-specific helper set. The names `invokeBuilder`/`invokePlanner`/`invokeReviewer`/`runPhase` are deleted; if any external plugin code depends on them, surface that in the migration plan and update those call sites in the same PR. |

## 6. Where ridgeline enhances fascicle (kept ridgeline-side)

These are real value-adds ridgeline brings on top of fascicle. They stay in
the ridgeline repo. If any prove generic enough to upstream, that's a
follow-up RFC, not part of this migration.

1. **Greywall sandbox policy.** Fascicle ships the *mechanism*
   (`sandbox: { kind: 'greywall', network_allowlist, additional_write_paths }`
   in `claude_cli` provider config). Ridgeline owns the *policy*: the
   `--sandbox` CLI flag mapping (`off | semi-locked | strict`), the
   default allowlist for each mode, and any path-resolution logic that
   computes per-build extra write paths. Existing
   `src/engine/claude/sandbox.greywall.ts` is rewritten as a small policy
   builder that produces a `SandboxProviderConfig` value, not a spawn
   wrapper. Decision: if every existing line ends up redundant once
   fascicle's provider handles the spawn, delete the file outright;
   record under the §11 risks.
2. **Stable-prompt cache budgeting.** Computes a context window budget and
   shapes the prompt to maximize Anthropic prompt-cache hits. Wraps the
   input to `model_call` steps (the user-side `ModelCallInput`).
3. **Sensor preflight + tool probe.** Pre-build sandbox-aware probe that
   verifies tool availability before the planner runs. Lives in `ui/`.
4. **Structured verdicts.** Ridgeline's `review_verdict`, `plan_artifact`,
   `specialist_verdict` schemas — ridgeline-domain Zod schemas passed to
   `model_call({ schema })`. Fascicle handles validation +
   `schema_repair_attempts` repair loops.
5. **Custom composites.** Several recurring ridgeline patterns are
   genuine `Step<i, o> → Step<i, o>` composites. They live in
   `src/engine/composites/` and follow fascicle's primitive contract
   (named display, `ctx` plumbing, abort-aware). See §6.1 for the set.
6. **Build-state resume.** `state.json` + tag-based git checkpoints span
   processes (resume after `Ctrl-C`); fascicle's `checkpoint` is per-step
   memoization. Ridgeline's outer resume logic stays.
7. **Retrospective + retro-refine.** Domain commands that read the build
   log post-hoc; unchanged.

### 6.1 Custom composites (Tier 1)

Each is a Step factory taking inner Steps and returning a composed Step,
written against fascicle's `Step<i, o>` contract so it interoperates with
every existing primitive. All live in `src/engine/composites/` and are
exported under that subpath. Tagged ⬆ are upstream candidates after the
migration settles.

#### `phase` — checkpoint + adversarial + feedback archive

Combines git checkpoint setup, fascicle's `adversarial`, per-round feedback
archival, and the round-cap contract into one value. Replaces the
imperative wrapper currently in `phase.sequence.ts`.

```ts
phase<input, candidate>({
  checkpoint_key:    (i: input) => string,
  setup_tag:         (i: input, ctx: RunContext) => Promise<void>,
  build:             Step<AdversarialBuildInput<input, candidate>, candidate>,
  critique:          Step<candidate, AdversarialCritiqueResult>,
  accept:            (c: AdversarialCritiqueResult) => boolean,
  archive_feedback?: (round: number, c: AdversarialCritiqueResult) => Promise<void>,
  max_rounds:        number,
}): Step<input, PhaseResult<candidate>>
```

#### `graph_drain` — DAG traversal with ready-sets + bounded concurrency ⬆

The phase-graph-drains-over-ready-sets pattern as a value. Replaces the
imperative `wave_loop_step` referenced in earlier drafts. Generic enough
to upstream — useful for any dependency-ordered task pipeline.

```ts
graph_drain<node, result>({
  nodes:        ReadonlyArray<node>,
  id_of:        (n: node) => string,
  deps_of:      (n: node) => ReadonlyArray<string>,
  do:           Step<node, result>,
  concurrency?: number,
  on_failure?:  'abort_all' | 'skip_dependents' | 'continue',
}): Step<unknown, ReadonlyMap<string, result>>
```

#### `worktree_isolated` — git-worktree-scoped execution with deterministic merge

Wraps an inner Step in a fresh git worktree, registers cleanup via
`ctx.on_cleanup`, and merges results back in a configurable order
(default `index_order` to honor invariant §7.4).

```ts
worktree_isolated<input, output>({
  worktree_path:    (i: input) => string,
  branch_from?:     string,
  do:               Step<input & { cwd: string }, output>,
  merge_back:       'index_order' | 'completion_order'
                  | ((results: ReadonlyArray<output>) => ReadonlyArray<output>),
  cleanup_on_fail?: boolean,
}): Step<input, output>
```

#### `diff_review` — build-then-review-on-diff

The build/commit/diff/review chain as a value. Pairs cleanly inside
`phase`'s `build` slot to express ridgeline's full per-phase loop.

```ts
diff_review<input, build_out, verdict>({
  build:        Step<input, build_out>,
  commit:       (out: build_out, ctx: RunContext) => Promise<{ before: string; after: string }>,
  compute_diff: (markers: { before: string; after: string }, ctx: RunContext) => Promise<string>,
  review:       Step<{ build_out: build_out; diff: string; input: input }, verdict>,
}): Step<input, { build_out: build_out; verdict: verdict }>
```

#### `cost_capped` — abort when cumulative cost exceeds threshold ⬆

Subscribes to cost events on `ctx.trajectory`, aborts the inner step's
controller when total exceeds `max_usd`. Finer-grained than ridgeline's
current per-wave check. Generic enough to upstream.

```ts
cost_capped<i, o>(
  inner: Step<i, o>,
  config: {
    max_usd:      number,
    on_exceeded?: (total_usd: number, ctx: RunContext) => void,
  },
): Step<i, o>
```

### 6.2 Custom composites (Tier 2 — land if Phase 4 reveals repetition)

Build only if the same pattern appears 3+ times in the `flows/` tree.
Otherwise leave imperative.

- **`with_stable_prompt(inner, { strategy })`** — pre-shapes
  `ModelCallInput` for prompt-cache hits. Replaces ad-hoc wrapping
  inside every atom.
- **`with_handoff(inner, { read_prior, write_next })`** — encodes the
  inter-stage handoff I/O contract (directions → design → spec → plan
  → build).
- **`specialist_panel({ members, aggregate })`** — `parallel(members)`
  + a typed reducer step. Names the panel-verdict pattern.
- **`adversarial_archived(adversarial_config, { archive })`** —
  decorator over fascicle's `adversarial` with a per-round side
  effect. Pick this **or** `phase`'s `archive_feedback` slot, not
  both.
- **`resumable(inner, { state_path, hash_input, encode, decode })`** —
  outer-resume across process invocations. Different from fascicle's
  intra-run `checkpoint`. Encodes the `state.json` pattern.

### 6.3 Other ridgeline-side enhancements (not composites)

- **Feedback file archival.** Implemented as `phase`'s
  `archive_feedback` slot (or `adversarial_archived`); no separate
  module needed.
- **Retrospective + retro-refine.** Domain commands that read the
  trajectory post-hoc; unchanged.

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

   Fascicle's runner installs SIGINT/SIGTERM handlers by default
   (`run(flow, input, { install_signal_handlers: true })`, the default).
   Once migrated, ridgeline's existing `process.on("SIGINT", ...)` in
   `src/cli.ts` becomes redundant and is removed; cleanup migrates to
   `ctx.on_cleanup(...)` registrations inside steps.
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
| `src/cli.ts` | EDIT | Remove the manual `process.on("SIGINT", ...)` once fascicle's runner default (`install_signal_handlers: true`) is in effect across every command. |
| `src/commands/*.ts` | WRAP | Each command builds a fascicle flow and calls `run(flow, input, opts)`. External signature unchanged. |
| `src/engine/index.ts` | REPLACE (incrementally) | Old re-exports stay until call sites migrate; final pass deletes them. |
| `src/engine/pipeline/*` | REPLACE | Each `*.exec.ts` becomes a `Step` (a `model_call(...)` plus framing) in the corresponding flow. |
| `src/engine/claude/claude.exec.ts` | DELETE | Replaced by fascicle's `claude_cli` provider configured at `create_engine`; per-call `Step`s via `model_call({ engine, model: 'cli-sonnet', ... })`. |
| `src/engine/claude/stream.*.ts` | DELETE | Fascicle's `claude_cli` provider emits typed `StreamChunk` events; ridgeline's stream-parse code goes away. |
| `src/engine/claude/sandbox.greywall.ts` | REWRITE → policy builder | Becomes a small module that produces a `SandboxProviderConfig` value (`{ kind: 'greywall', network_allowlist, additional_write_paths }`) from ridgeline's `--sandbox` flag and per-build context. No more spawn wrapping. May be deletable if the policy ends up trivial. |
| `src/engine/claude/sandbox.ts`, `sandbox.types.ts` | KEEP or REWRITE | Re-evaluate once `sandbox.greywall.ts` is rewritten; sandbox detection logic likely stays, the spawn-wrapping types go. |
| `src/engine/claude/stable.prompt.ts` | KEEP | Used to shape the `ModelCallInput` passed to `model_call` steps. |
| `src/engine/claude/agent.prompt.ts` | KEEP | Used by flow steps. |
| `src/engine/discovery/*` | KEEP | Domain. |
| `src/engine/detect/*` | KEEP | Domain. |
| `src/engine/worktree.ts` | KEEP | Worktree primitives used by the wave-loop composer. |
| `src/engine/flows/*` | NEW | New directory: `build.flow.ts`, `plan.flow.ts`, `dryrun.flow.ts`, `auto.flow.ts`. Top-level `sequence`/`branch` compositions per command; reach for composites + atoms. |
| `src/engine/atoms/*` | NEW | New directory: each atom is a `Step` produced by `model_call({ engine, model, system, schema?, tools? })` for builder, reviewer, planner, specialist, refiner, researcher, specifier. |
| `src/engine/composites/*` | NEW | New directory of ridgeline-specific `Step<i, o> → Step<i, o>` composites: `phase.ts`, `graph_drain.ts`, `worktree_isolated.ts`, `diff_review.ts`, `cost_capped.ts` (Tier 1). Tier 2 added later if patterns repeat. See §6.1, §6.2. |
| `src/engine/adapters/*` | NEW | Ridgeline-side `TrajectoryLogger` and `CheckpointStore` implementations that target ridgeline's existing on-disk formats. |
| `src/stores/state.ts` | KEEP | Outer resume logic; uses fascicle's `CheckpointStore` only for per-step memoization. |
| `src/stores/budget.ts` | WRAP | Cost events flow through `ctx.trajectory`; ridgeline supplies a `TrajectoryLogger` decorator that tallies into `budget.json`. Replaces explicit `recordCost(...)` calls. |
| `src/stores/trajectory.ts` | WRAP | Becomes a `TrajectoryLogger` adapter that writes to the existing `.jsonl` path. Composed with fascicle's `tee_logger` if a second sink is needed. |
| `src/stores/phases.ts`, `tags.ts`, `handoff.ts`, `feedback.*` | KEEP | Domain stores. |
| `src/agents/*`, `src/sensors/*`, `src/ui/*`, `src/catalog/*`, `src/shapes/*`, `src/references/*` | KEEP | Domain. |
| `package.json` | EDIT | Add `fascicle` and `zod` runtime deps; add `@ai-sdk/anthropic` only if direct-API calls are wanted (the `claude_cli` provider needs no peer deps beyond zod). Bump `engines.node` to `>=24`. Remove `commander`-adjacent stream-parsing helpers ridgeline used for `claude.exec.ts` once the call sites are gone. |
| `tsconfig.json` | EDIT | Confirm `target` / `lib` settle on Node 24 baseline. |

## 9. Phase ordering (safe self-bootstrap)

The migration must be runnable by ridgeline itself. To avoid tearing out the
substrate the running build is using, every phase is self-contained: at the
end of each phase, `npm run check` passes and `ridgeline build` works.

The build is run from a **separately installed ridgeline binary** (e.g.
`npm i -g ridgeline@stable`) operating on a worktree of `main`. The binary
under migration is never the binary executing the migration.

### Phase 0 — Scaffold

- Install: `npm install fascicle zod`. Fascicle is published on npm
  ([`fascicle` on npm](https://www.npmjs.com/package/fascicle); repo:
  [github.com/robmclarty/fascicle](https://github.com/robmclarty/fascicle)).
  Pin to a known-good version (current at time of writing: `0.3.x`).
- Provider peer deps: ridgeline's `claude_cli` route requires **no extra
  peer deps**. If/when ridgeline calls direct Anthropic API
  (e.g. `provider: 'anthropic'`), add `@ai-sdk/anthropic` and `ai` per
  fascicle's peer dep list.
- Bump `engines.node` in `package.json` from `>=20.0.0` to `>=24.0.0`
  to satisfy fascicle's declared minimum (`engines.node: ">=24.0.0"`).
- Update CI matrix to drop Node 20, add Node 24.
- Create empty `src/engine/flows/`, `src/engine/atoms/`, `src/engine/adapters/`.
- Add a smoke test that imports `run, sequence, step, model_call,
  create_engine` from `fascicle` and asserts they're functions. Also
  import `filesystem_logger, filesystem_store, tee_logger` from
  `fascicle/adapters`.
- **Exit criteria:** `npm run check` green; no behavior change.

### Phase 1 — Adapters

- Implement `ridgeline_trajectory_logger` that satisfies fascicle's
  `TrajectoryLogger` and writes to ridgeline's existing `.jsonl` path/shape.
- Implement `ridgeline_checkpoint_store` (filesystem-backed, scoped under
  `.ridgeline/builds/<name>/state/`) for per-step memoization. Keep
  `state.json` outer-resume logic untouched.
- Implement `ridgeline_budget_subscriber` that reads cost events off the
  trajectory and tallies into `budget.json`. Compose with the trajectory
  logger via `tee_logger`.
- Rewrite `src/engine/claude/sandbox.greywall.ts` as a `buildSandboxPolicy(cfg):
  SandboxProviderConfig` builder consumed by `make_ridgeline_engine`.
- **Exit criteria:** unit tests for each adapter green; old `recordCost`,
  `logTrajectory` still in place; no production call sites moved yet.

### Phase 1.5 — Composites

- Implement Tier 1 composites in `src/engine/composites/` against fascicle's
  `Step<i, o>` contract:
  - `phase.ts` — wraps `adversarial` with checkpoint setup + per-round
    archive hook.
  - `graph_drain.ts` — DAG ready-set traversal with bounded concurrency
    and configurable failure policy.
  - `worktree_isolated.ts` — git-worktree isolation with deterministic
    merge order; uses `ctx.on_cleanup` for worktree teardown.
  - `diff_review.ts` — build → commit → diff → review chain.
  - `cost_capped.ts` — trajectory-subscribed budget cap with
    fine-grained abort.
- Each composite ships with a unit test suite that exercises the
  primitive contract: abort propagation, trajectory event emission,
  cleanup registration, error surfacing. Inner Steps are stubs.
- **Exit criteria:** all five composites green in isolation; not yet
  wired to commands; old imperative code untouched.

### Phase 2 — Atoms

- One shared engine factory: `make_ridgeline_engine(cfg)` calls
  `create_engine({ providers: { claude_cli: { auth_mode: 'auto', sandbox:
  build_sandbox_policy(cfg), plugin_dirs, setting_sources, ... } } })`.
  Returns the `Engine`; callers `await engine.dispose()` in a `finally`
  block of the command entry point.
- Each atom is a `Step` produced by `model_call`, optionally wrapped to
  shape input/output. Sketch:

  ```ts
  // src/engine/atoms/builder.atom.ts
  import { model_call, pipe, step } from 'fascicle'
  import type { Engine } from 'fascicle'

  export const buildBuilderAtom = (engine: Engine) =>
    pipe(
      step('shapeBuilderInput', (args: BuilderArgs) => buildBuilderPrompt(args)),
      model_call({ engine, model: 'cli-sonnet', system: BUILDER_SYSTEM, tools: BUILDER_TOOLS }),
    )
  ```

- Atom set: `builder.atom`, `reviewer.atom` (uses `model_call({ schema:
  reviewVerdictSchema })`), `planner.atom`, `specialist.atom`,
  `refiner.atom`, `researcher.atom`, `specifier.atom`.
- Atoms are tested in isolation with a stub engine (a fascicle `Engine`
  whose `generate` returns canned `GenerateResult` values).
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

- The big one. Migrate `commands/build.ts` using the composites:
  - The per-phase pattern is `phase({ checkpoint_key, setup_tag,
    build: diff_review({ build: builder_atom, ..., review: reviewer_atom }),
    critique, accept, archive_feedback, max_rounds })`.
  - The wave pattern is `worktree_isolated({ ..., do: phase_flow })`
    composed inside `graph_drain({ nodes: phases, deps_of, do: ... })`.
  - The whole build is `cost_capped(sequence([...]), { max_usd })`.
  - `flows/build.flow.ts` is the top-level `sequence` wiring inputs →
    plan-if-needed → graph_drain → retrospective.
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

1. **Node version bump.** Fascicle's `package.json` declares
   `engines.node: ">=24.0.0"`. Ridgeline targets `>=20`. Bump
   ridgeline's `engines.node` to `>=24.0.0` and update CI; communicate
   the bump in CHANGELOG. Fascicle also declares `engines.pnpm:
   ">=9.0.0"` informationally — npm consumers ignore it.
2. **Naming convention boundary.** Fascicle uses `snake_case` for all
   exports (`create_engine`, `model_call`, `tee_logger`, `aborted_error`).
   Ridgeline uses `camelCase` (per existing memory: `isMerged`-style
   booleans). Rule: ridgeline-side identifiers stay `camelCase`;
   fascicle imports keep their `snake_case` form. No alias re-exports —
   the boundary should be visible at call sites.
3. **`engine.dispose()`.** Fascicle's `create_engine` returns an `Engine`
   with `dispose()`. Ownership: one engine per command invocation, built
   via `make_ridgeline_engine(cfg)`, disposed in a `finally` block at
   the command entry point.
4. **Custom composites are ridgeline-side first.** Tier 1 composites
   (§6.1) live in `src/engine/composites/` and are not part of fascicle.
   `graph_drain` and `cost_capped` are flagged as upstream candidates
   (⬆) — after the migration settles and the contracts have been
   exercised in production, raise an RFC against fascicle. Out of
   scope for this migration.
5. **`claude_cli` provider capabilities (verified against fascicle docs).**
   - Sandbox: ✅ first-class via `sandbox: { kind: 'greywall' | 'bwrap',
     network_allowlist, additional_write_paths }`.
   - Auth: ✅ `auto | oauth | api_key`; ridgeline likely wants `auto`
     so subscription auth works without `ANTHROPIC_API_KEY`.
   - Plugin dirs / setting sources: ✅ `plugin_dirs`, `setting_sources`
     pass through.
   - Streaming: ✅ typed `StreamChunk` events on `ctx.trajectory`.
   - Cost reporting: ✅ flows through `ctx.trajectory` per fascicle's
     emission rules.
   - Abort propagation: ✅ `ctx.abort` is an `AbortSignal` honored by
     the subprocess.
   - Model aliases: ✅ `cli-sonnet`, `cli-opus`, `cli-haiku` (verify
     against ridgeline's current alias set; adjust ridgeline's
     `resolveModel` to map old → fascicle).
   - Timeouts: `startup_timeout_ms` (default 120s), `stall_timeout_ms`
     (default 300s) — verify these line up with ridgeline's
     `--timeout <minutes>` flag; map appropriately.
   - `skip_probe`: opt-out of the binary probe; relevant for tests.
6. **Trajectory event shape.** Fascicle emits typed `TrajectoryEvent`
   values via the `TrajectoryLogger` contract. Ridgeline's adapter
   either (a) writes fascicle's events verbatim, breaking
   backward-compat with old `.jsonl` consumers, or (b) translates to
   ridgeline's existing schema. Decide in Phase 1; if (a), update
   `docs/long-horizon.md` and any external consumers.
7. **Plugin compatibility.** `src/engine/index.ts` is consumed by
   plugins (via `plugin/` discovery). Determine which exports are
   load-bearing externally before deleting them in Phase 6. Likely
   candidates: `parseStreamLine`, `createStreamHandler`, `extractResult`
   — these go away with `claude.exec.ts`. If plugins depend on them,
   surface a replacement (probably a thin reader over fascicle's
   `StreamChunk`).
8. **Direct API vs CLI route.** Fascicle's `claude_cli` provider is
   sufficient for ridgeline's current behavior. If/when ridgeline wants
   direct Anthropic API access (e.g. for cheaper Haiku calls without
   spawning a subprocess), add the `anthropic` provider to
   `create_engine`'s providers map and add `@ai-sdk/anthropic` + `ai`
   peer deps. Out of scope for this migration; recorded for awareness.

## 12. Done definition

The migration is done when **all** are true:

- [ ] All twelve §7 invariants verified by automated tests.
- [ ] `src/engine/pipeline/` is deleted.
- [ ] `src/engine/claude/{claude.exec,stream.*}.ts` are deleted.
- [ ] `src/engine/flows/`, `src/engine/atoms/`, `src/engine/composites/`,
      `src/engine/adapters/` contain the new core.
- [ ] Tier 1 composites (`phase`, `graph_drain`, `worktree_isolated`,
      `diff_review`, `cost_capped`) covered by isolated unit tests *and*
      exercised by the build flow's E2E fixtures.
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
