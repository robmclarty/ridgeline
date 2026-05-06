<!-- role: data -->
# Constraints

## Language and Runtime

- TypeScript 5.9.3 (strict mode, ESM only — no CommonJS shims).
- Node.js `>=24` (bumped from `>=20` in Phase 0; CI matrix runs Node 24 only — Node 20 entries are removed).
- Module system: ESM (`"type": "module"` semantics; no `require()` in production code).

## Framework and Core Dependencies

- **fascicle** `0.3.x` (exact-pinned per `.npmrc save-exact=true`) — orchestration core (runtime dependency). Provides composition primitives (`step`, `sequence`, `parallel`, `branch`, `map`, `pipe`, `retry`, `fallback`, `timeout`, `loop`, `compose`, `checkpoint`, `suspend`, `scope`, `stash`, `use`, `describe`), composites (`adversarial`, `ensemble`, `consensus`, `tournament`), engine (`create_engine`, `model_call`), runner (`run`, `run.stream`), typed errors (`aborted_error`, `engine_config_error`, `model_not_found_error`, `provider_error`, `provider_capability_error`, `provider_not_configured_error`, `rate_limit_error`, `schema_validation_error`, `tool_error`, `tool_approval_denied_error`, `on_chunk_error`), and the built-in `claude_cli` provider.
- **fascicle/adapters** subpath — `filesystem_logger`, `http_logger`, `noop_logger`, `tee_logger`, `filesystem_store`. `TrajectoryLogger` and `CheckpointStore` contracts re-exported from fascicle root.
- **zod** `4.x` (exact-pinned per `.npmrc save-exact=true`) — runtime peer of fascicle 0.3.x (major version dictated by fascicle's peer-dependency, not a project choice), used for `review_verdict`, `plan_artifact`, `specialist_verdict` schemas passed to `model_call({ schema })`.
- **claude_cli provider** (built into fascicle) — owns Claude subprocess spawn, greywall/bwrap sandbox kinds, auth modes (`auto | oauth | api_key`), `plugin_dirs`, `setting_sources`, `default_cwd`, `startup_timeout_ms`, `stall_timeout_ms`, `skip_probe`. Defaults: `auth_mode: 'auto'`, `startup_timeout_ms: 120_000`, `stall_timeout_ms: 300_000` (or `timeoutMinutes * 60_000` when `--timeout` is set).
- **commander** `13.0.0` — kept as the CLI parser; no parser swap is introduced as a side effect.
- **fascicle-viewer** — NOT a runtime dependency; consumed via its bin and via `start_viewer`/`run_viewer_cli` imports when a user opts in.
- **NOT ADDED**: `@ai-sdk/anthropic`, `ai` (Vercel AI SDK), direct Anthropic API access.

## Tooling (kept; versions unchanged)

- vitest `4.1.2` — unit and integration tests; vitest.e2e.config.ts retained for E2E.
- @stryker-mutator/core `9.6.1` — mutation testing, scope changed at Phase 7 to `src/engine/{flows,atoms,composites,adapters}/**/*.ts`.
- oxlint `1.58.0` — type-aware lint.
- ast-grep `0.42.1` — structural rules; new rules added during this migration for boundary enforcement, dispose-in-finally, and ANSI/emoji exclusion in new directories.
- agnix `0.17.0` — agent checks.
- fallow `2.13.0` — dead-code detection.
- cspell `10.0.0` — spell checking.
- markdownlint-cli2 `0.21.0` — docs lint.
- playwright — kept as optional peer.

## Directory Layout

- `src/cli.ts` — entry point. After Phase 6, contains zero `process.on('SIGINT', ...)` registrations.
- `src/commands/<name>.ts` — one file per CLI subcommand; thin shells that call `run(flow, input, opts)` with `engine.dispose()` in a finally block. External function signatures are byte-equal to the Phase 0 `.d.ts` baseline.
- `src/engine/engine.factory.ts` — exports `makeRidgelineEngine(cfg): Engine`. The only call site of fascicle's `create_engine` in the codebase.
- `src/engine/flows/<command>.flow.ts` — per-command fascicle flows (build.flow.ts, auto.flow.ts, plan.flow.ts, dryrun.flow.ts, research.flow.ts, etc.).
- `src/engine/atoms/<role>.atom.ts` — model_call-based steps (builder, reviewer, planner, specialist, refiner, researcher, specifier, sensors.collect, plan.review, specialist.verdict).
- `src/engine/composites/<name>.ts` — Tier 1 composites: `phase.ts`, `graph_drain.ts`, `worktree_isolated.ts`, `diff_review.ts`, `cost_capped.ts`, plus `index.ts` barrel. No Tier 2 composites unless Phase 4 audit reveals 3+ repetitions.
- `src/engine/adapters/ridgeline_<role>.ts` — `ridgeline_trajectory_logger.ts`, `ridgeline_checkpoint_store.ts`, `ridgeline_budget_subscriber.ts`, plus `index.ts` barrel.
- `src/engine/claude/sandbox.policy.ts` — `buildSandboxPolicy(args): SandboxProviderConfig | undefined`. Replaces sandbox.greywall.ts at Phase 2.
- `src/engine/claude/{stable.prompt,agent.prompt,sandbox,sandbox.types}.ts` — KEPT (sandbox.ts and sandbox.types.ts reduced to detection helpers and config types).
- `src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}.ts` — DELETED at Phase 7.
- `src/engine/pipeline/` — DELETED entirely at Phase 7.
- `src/engine/{discovery,detect}/`, `src/engine/worktree.ts`, `src/git.ts` — KEPT.
- `src/stores/{state,phases,tags,handoff,settings,inputs,budget,trajectory,feedback.format,feedback.io,feedback.parse,feedback.verdict}.ts` — KEPT (`budget.ts` and `trajectory.ts` wrapped so cost/event flow goes through `ctx.trajectory`; underlying file writers unchanged).
- `src/agents/`, `src/sensors/`, `src/ui/`, `src/catalog/`, `src/shapes/`, `src/references/` — KEPT verbatim.
- Tests: `src/__tests__/`, `src/engine/__tests__/`, `src/stores/__tests__/`, `src/commands/__tests__/`, plus new `src/engine/{atoms,composites,flows,adapters}/__tests__/` directories. `vitest.e2e.config.ts` UNCHANGED.
- `.check/` — npm run check output directory (unchanged).
- `.ridgeline/builds/fascicle-migration/baseline/` — Phase 0 baseline artifact directory (--help snapshots, .d.ts snapshots, trajectory/state/budget/phases fixtures, error-shape snapshots, mutation-score baseline, claude_cli capability matrix).
- `.ridgeline/builds/fascicle-migration/phase-<N>-check.json` — per-phase exit gate artifacts.
- `.ridgeline/builds/fascicle-migration/dogfood-evidence.md` — Phase 6 dogfood gate.
- `.ridgeline/builds/fascicle-migration/phase-5-plugin-surface-audit.md` — plugin consumer enumeration before Phase 7 deletion.
- `.ridgeline/builds/fascicle-migration/phase-4-tier2-audit.md` — Tier 2 composite repetition counts.
- `.ridgeline/builds/fascicle-migration/invariants.md` — checklist mapping each of the twelve §7 invariants to its test file and test name.

## Naming Conventions

The naming-convention boundary is explicit and visible at every call site — no alias re-exports hide it.

- **Fascicle imports**: snake_case, exactly as fascicle exports them (`create_engine`, `model_call`, `run`, `sequence`, `parallel`, `branch`, `map`, `pipe`, `retry`, `fallback`, `timeout`, `loop`, `adversarial`, `ensemble`, `tournament`, `consensus`, `checkpoint`, `suspend`, `scope`, `stash`, `use`, `describe`, `tee_logger`, `filesystem_logger`, `aborted_error`, `rate_limit_error`, `provider_error`, `schema_validation_error`, etc.). No `export ... as <camelCaseName>` re-exports.
- **Ridgeline-side identifiers**: camelCase. The engine factory is `makeRidgelineEngine` (camelCase, ridgeline-side, even though it builds a fascicle Engine).
- **Booleans**: prefixed with `is`, `has`, or `should` (e.g., `isMerged`, `hasCheckpoint`, `shouldRetry`).
- **File names**: kebab-case-with-dots compound names matching existing repo style (e.g., `phase.atom.ts` follows the `*.exec.ts → *.atom.ts` rename pattern; `build.flow.ts`, `worktree_isolated.ts` for snake_case-aligned composite names because they implement fascicle's `Step` contract).
- **New trajectory event types**: ridgeline-emitted use camelCase; fascicle-emitted retain snake_case as fascicle emits them.

## API Style

- Internal composition uses fascicle's `Step<i,o>` primitive contract. Step factories return `Step` instances decorated via `describe('<name>')` so trajectory events carry stable, human-readable names.
- Composers use `pipe`, `sequence`, `parallel`, `branch`, `map`, `retry`, `fallback`, `timeout`, `loop`.
- Side effects (trajectory, cost, cleanup) flow through `ctx` (RunContext): `ctx.trajectory.emit(...)`, `ctx.on_cleanup(...)`, `ctx.signal`. Direct `console.log/error` and `process.stdout/stderr.write` are forbidden in `src/engine/{flows,atoms,composites,adapters}/` (enforced by ast-grep).
- Atom shape: every atom is `pipe(promptShaper, model_call({ engine, model, system, schema?, tools? }))` where `promptShaper` is `src/engine/claude/stable.prompt.ts` (preserved verbatim to maintain prompt-cache hit rate).
- Schema-bearing atoms pass ridgeline's existing Zod schemas (`review_verdict`, `plan_artifact`, `specialist_verdict`) directly to `model_call({ schema })` so fascicle handles validation and `schema_repair_attempts`.
- Command entry-point shape:
  ```ts
  const engine = makeRidgelineEngine(cfg);
  try {
    await run(flow, input, { trajectory, checkpoint_store, install_signal_handlers: true });
  } finally {
    await engine.dispose();
  }
  ```
- External CLI flag set, command signatures, and help text are unchanged from the Phase 0 baseline.

## Error Handling

- Replace ridgeline's regex-based `FATAL_PATTERNS` and `classifyError` with `instanceof` checks against fascicle's typed error classes.
- Retry policy uses fascicle's `retry({ max_attempts, backoff_ms, on_error })` preserving existing exponential-backoff-with-jitter defaults.
- `on_error` returns `true` (retry) for: `rate_limit_error`, `provider_error` when status ∈ 5xx or network, `on_chunk_error`.
- `on_error` returns `false` (abort) for: `aborted_error`, `engine_config_error`, `model_not_found_error`, `schema_validation_error`, `tool_approval_denied_error`, `provider_capability_error`, `provider_not_configured_error`, `tool_error`.
- `aborted_error` always short-circuits all retry layers and propagates cancellation.
- Auth errors, schema-violation errors, and budget-exceeded abort the build and surface the user-facing error message ridgeline emits today (snapshot test against `baseline/fixtures/error-shapes.json`).
- Adversarial round-cap exhaustion (`maxRetries+1` unsuccessful rounds) surfaces an error whose `.name` and `.message` match the Phase 0 fixture.
- Exit code 130 on SIGINT is preserved.

## Sandbox Policy

- `buildSandboxPolicy(args)` returns `undefined` for `sandboxFlag === 'off'` and `{ kind: 'greywall', network_allowlist, additional_write_paths }` for `'semi-locked'` and `'strict'`.
- Default `network_allowlist` for each flag value is exported as a `const` and matches the host list ridgeline's pre-migration spawn wrapper allowed (no widening; an audit diff is captured in the Phase 2 PR).
- `buildPath` is always present in `additional_write_paths`.
- Greywall enforcement is non-negotiable: existing greywall integration tests pass at Phase 2 exit with zero modifications.
- `auth_mode: 'auto'` preserves subscription/OAuth path; `ANTHROPIC_API_KEY` is not required.

## Resume and Checkpoint Coexistence

- Outer cross-process resume: `state.json` + git tags, owned exclusively by `src/stores/state.ts` and `src/stores/tags.ts`. Lifecycle unchanged.
- Intra-run per-step memoization: fascicle `CheckpointStore` writes only under `.ridgeline/builds/<name>/state/<step-id>.json`. Never touches `state.json` or git tags.
- The two layers must never overlap or share files. A regression test asserts `ridgeline build` resumes across process boundaries via state.json + tags after the migration.

## Test and Mutation Constraints

- All existing tests carried forward; no test file deleted without a same-PR replacement at the same abstraction level. Old → new mapping recorded in PR descriptions.
- Each Tier 1 composite: ≥ 4 unit tests covering abort propagation, trajectory event emission, `ctx.on_cleanup` registration, error surfacing.
- Each atom: ≥ 1 unit test using a stub Engine that returns canned `GenerateResult` values; no live `claude_cli` provider invocations in unit tests.
- Test fixtures pass `skip_probe: true` to fascicle's `claude_cli` provider.
- Stryker config's `mutate` glob covers exactly `src/engine/{flows,atoms,composites,adapters}/**/*.ts` at Phase 7.
- Mutation score on the new scope must be ≥ the Phase 0 baseline mutation score on `src/engine/pipeline/` (recorded in `baseline/mutation-score.json`). If Phase 0's Stryker run was blocked by the active sandbox (recorded as `captured: false`), capture the absolute pre-migration score at Phase 7 outside the sandbox before asserting the new-scope gate.
- Snapshot tests for `ridgeline --help` and per-subcommand `--help` lock byte equality against `baseline/help/`.
- Snapshot tests for command external signatures via `tsc --emitDeclarationOnly` lock byte equality against `baseline/dts/`.
- Fixture-replay tests for state.json, phases/<id>.md, trajectory.jsonl (existing event types), budget.json against `baseline/fixtures/`.

## Phase Discipline

- Each phase produces at least one commit on the fascicle branch (the ridgeline builder loop owns commit naming — no specific subject prefix is required). The phase-exit gate is the `phase-<N>-check.json` artifact, not the commit subject.
- Each phase's exit commit must have: (a) `npm run check` green; (b) `ridgeline build` operational against this build's `.ridgeline/builds/fascicle-migration/` directory; (c) `.ridgeline/builds/fascicle-migration/phase-<N>-check.json` artifact captured (the `.check/summary.json` snapshot at that commit).
- Each phase-`<N>`-check.json must show zero failures across types, lint, struct, agents, dead code, docs, spell, tests.
- Intermediate commits within a phase use any descriptive subject, follow Conventional Commits style matching repo history (`feat(scope):`, `fix(scope):`, `chore:`, `docs:`, `refactor:`).
- Co-authored-by Claude trailer is permitted per repo norms.
- Commits never bypass hooks (`--no-verify`) or signing.
- The migration is executed by a separately installed stable ridgeline binary operating on a worktree of main — never the binary under migration.
- Phase 6 dogfood gate: `ridgeline build --auto` against this build's spec/constraints/taste/design completes without manual intervention; recorded in `dogfood-evidence.md`.

## Design Tokens

The migration has no UI surface. The following hard tokens describe output-medium fidelity that must hold across the substrate swap.

- **Output medium**: ASCII / terminal text via stdout and stderr only.
- **On-disk artifacts**: Markdown (`.md`), JSON (`.json`), JSON Lines (`.jsonl`). No binary files, no images, no HTML produced or modified by the migration.
- **state.json**: schema-stable for existing fields; new fields are additive and optional; pre-migration `state.json` fixtures load and resume.
- **phases/<id>.md**: byte-equivalent to pre-migration output for the same prompt input (verified by fixture snapshot).
- **trajectory.jsonl**: path is `.ridgeline/builds/<name>/trajectory.jsonl`; existing event types retain their JSON shape exactly; new event types only add fields, never rename or remove existing ones.
- **budget.json**: cumulative totals match the previous implementation within 1e-9 USD; integer-cent equality where the format already integerizes.
- **Handoff and feedback files**: existing markdown layout, frontmatter, and naming preserved.
- **Tag-based outer resume**: contract preserved; `stores/state.ts` and `stores/tags.ts` retain exclusive ownership.
- **CLI flag set**: unchanged across all 19+ subcommands.
- **Exit codes**: unchanged; 130 on SIGINT preserved.
- **Terminal output**: no emoji; no new ANSI escape sequences, color codes, banners, or progress glyphs introduced beyond what `src/ui/*` and prior `stream.display.ts` emitted.
- **Streaming model output**: same chunked cadence (token/line streaming preserved, not buffered to end-of-call).
- **Naming boundary**: fascicle imports stay snake_case; ridgeline identifiers stay camelCase; no alias re-exports.
- **Env contracts preserved**: `NO_COLOR` suppresses color output; `FORCE_COLOR` overrides; non-TTY stdout disables spinners/colors.

## Check Command

```
npm run check
```

Runs the full pipeline (types, lint, struct, agents, dead code, docs, spell, tests) and writes per-tool output to `.check/` plus a normalized `.check/summary.json`. Must be green at every phase exit and after every task per repo CLAUDE.md.
