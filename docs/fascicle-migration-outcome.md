# Fascicle Migration: Outcome Comparison

Snapshot of what changed when ridgeline's orchestration core moved onto
[fascicle](https://github.com/robmclarty/fascicle). Captured at the end of
the `fascicle-migration` build.

## Code shape — simpler in posture, not in raw count

- **Engine core LOC** (excl. tests): 5,800 (main) → 8,028 (fascicle).
  Net growth is misleading: hand-rolled orchestration is gone and its
  replacement is mostly thin glue plus a comprehensive composite test suite.
- **Deleted**
  - `src/engine/pipeline/` — 21 files, 4,095 LOC. All `*.exec.ts` /
    `phase.sequence.ts` / `phase.graph.ts` / `worktree.parallel.ts` /
    `ensemble.exec.ts` / `specialist.verdict.ts` / etc.
  - `src/engine/claude/{claude.exec,stream.parse,stream.display,stream.result,stream.types}.ts`
    — 5 files, ~610 LOC.
  - Regex-based error classification (`FATAL_PATTERNS`, `classifyError`)
    is gone. Retry/abort semantics now use `instanceof` against fascicle's
    typed errors (`aborted_error`, `rate_limit_error`, `provider_error`,
    `schema_validation_error`, `provider_capability_error`,
    `provider_not_configured_error`, `tool_error`,
    `tool_approval_denied_error`, `on_chunk_error`, `engine_config_error`,
    `model_not_found_error`).
- **Added**
  - `src/engine/flows/` — 17 thin composition files (one per command).
  - `src/engine/atoms/` — each atom is a `pipe(promptStep, model_call(...))`
    `Step<i,o>` value (builder, planner, reviewer, refiner, researcher,
    specialist, specifier, plus `plan.review` and `sensors.collect`).
  - `src/engine/composites/` — five ridgeline-specific
    `Step<i,o> → Step<i,o>` combinators (see below).
  - `src/engine/adapters/` — three bridges to ridgeline's on-disk formats
    (`ridgeline_trajectory_logger`, `ridgeline_checkpoint_store`,
    `ridgeline_budget_subscriber`).
  - `src/engine/engine.factory.ts` — 72 LOC; the single
    `makeRidgelineEngine(cfg)` entry point.
- **Mixed result.** `src/commands/build.ts` is 412 LOC vs 455 on main;
  the seed targeted ~40 LOC of input plumbing + `run(...)`. Command-side
  wiring did not shrink as much as intended.
- **Branch totals.** +31,276 / -4,562 across 451 files. Most of the bulk is
  tests, the composite suites, and the dogfood build artifacts under
  `.ridgeline/builds/fascicle-migration/`.

## Multi-model support

Fascicle's `create_engine({ providers: { ... } })` supports multiple
providers (`claude_cli`, `anthropic`, `openai`, `google`, `ollama`,
`lmstudio`, `openrouter`). Ridgeline now wires both `claude_cli`
(always) and `anthropic` (gated on `ANTHROPIC_API_KEY` being present in
the environment). Ridgeline's own `RIDGELINE_ALIASES` table is gone;
fascicle's built-in aliases handle resolution.

Resulting model selection surface (`--model <name>`):

| Name | Routes to | Notes |
|---|---|---|
| `cli-opus`, `cli-sonnet`, `cli-haiku` | `claude_cli` | Subscription / OAuth auth. **Default is `cli-opus`.** |
| `opus`, `sonnet`, `haiku` | `anthropic` API | Requires `ANTHROPIC_API_KEY`. |
| `claude-opus`, `claude-sonnet`, `claude-haiku` | `anthropic` API | Same as bare names. |
| `anthropic:claude-haiku-4-5` (etc.) | `anthropic` API | Pin a specific model id. |
| `openai:…`, `google:…`, `openrouter:…`, `ollama:…`, `lmstudio:…` | other providers | Resolved by fascicle. *Not yet wired in `engine.factory.ts`.* |

Adding the remaining providers is a config-only change in
`engine.factory.ts` plus the corresponding `@ai-sdk/*` peer dep. Skills,
tools, and agent discovery still depend on `claude_cli` provider
specifics — that's why bare model name resolution differs from
mainline Claude Code's defaults.

## New capabilities the migration unlocks

1. **Typed-error retry semantics.**
   `retry({ on_error: e => e instanceof rate_limit_error })` instead of
   regex pattern matching.
2. **`cost_capped` composite** (`src/engine/composites/cost_capped.ts`).
   Trajectory-subscribed, fine-grained, abort-aware. Replaces main's
   per-wave budget check; can abort an in-flight step at the budget edge.
3. **`graph_drain` composite.** DAG ready-set traversal with bounded
   concurrency and configurable failure policy
   (`abort_all | skip_dependents | continue`). Upstream-RFC candidate.
4. **`worktree_isolated` composite.** Git-worktree-scoped execution with
   deterministic merge order (`index_order | completion_order | custom`)
   and cleanup via `ctx.on_cleanup`.
5. **`diff_review` composite.** build → commit → diff → review chain as a
   single value.
6. **`phase` composite.** Adversarial + checkpoint setup + per-round
   feedback archive in one combinator. Replaces the imperative wrapper
   that used to live in `phase.sequence.ts`.
7. **Schema-validated model calls.** `model_call({ schema })` with
   fascicle-handled `schema_repair_attempts` repair loops; ridgeline's
   `review_verdict`, `plan_artifact`, `specialist_verdict` Zod schemas
   plug in directly.
8. **Trajectory `tee_logger`.** A second sink can drive `fascicle-viewer`
   alongside ridgeline's UI from the same event stream, without
   duplicating instrumentation.
9. **Default SIGINT/SIGTERM handling** via fascicle's runner. The manual
   `process.on("SIGINT", ...)` is gone from `cli.ts`; cleanup is
   registered per-step via `ctx.on_cleanup`.
10. **Two-level resumability.** Per-step `checkpoint_store` memoization
    inside a run, layered under the existing `state.json` outer-resume
    across processes.
11. **Atoms are first-class `Step` values.** Every atom composes with any
    fascicle primitive — `ensemble`, `tournament`, `consensus`, `improve`,
    `bench`, `judge_equals`, `judge_llm`, `judge_with`. Today only
    `ensemble` is used (planner); the rest are latent capability.

## Bottom line

The win is **posture**, not line count. Orchestration is now declarative
composition over typed primitives with a clean shell/core boundary, instead
of imperative pipeline loops with regex error classification. Multi-model
support is one config block away rather than a refactor. The build flow's
command shell didn't shrink as much as the seed hoped — worth weighing when
reading the build's learnings.
