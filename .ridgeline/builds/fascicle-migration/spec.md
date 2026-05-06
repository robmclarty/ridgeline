<!-- role: data -->
# fascicle-migration: ridgeline shell + fascicle core substrate swap

## Overview

Replace ridgeline's hand-rolled orchestration internals (sequence, retry, parallel, adversarial, checkpoint, abort, trajectory, budget) with fascicle's primitive set, while preserving every externally observable behavior — CLI flag set, exit codes, terminal output style, on-disk file formats (state.json, phases/<id>.md, feedback files, tags, trajectory.jsonl, budget.json, handoff files), sandbox enforcement, prompt-cache hit rate, and resume semantics. This is a substrate swap, not a redesign.

The migration unfolds in eight self-bootstrap-safe phases (0 Scaffold/baseline → 1 Adapters → 2 Sandbox policy → 3 Tier 1 composites → 4 Atoms → 5 Leaf flows → 6 Build + auto + SIGINT → 7 Cleanup + deletions + docs). Each phase exits only when `npm run check` is green, `ridgeline build` is operational against this build's directory, and the phase's exit-gate artifact (`.ridgeline/builds/fascicle-migration/phase-<N>-check.json`) is captured. The migration binary is a separately installed stable ridgeline operating on a worktree of main; the binary under migration never executes itself.

Done means src/engine/pipeline/ is deleted, src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}.ts are deleted, every command runs through `run(flow, input, opts)` with a per-invocation Engine disposed in finally, all twelve §7 invariants are verified by automated tests, the five Tier 1 composites have unit + E2E coverage, scoped Stryker mutation testing meets the Phase 0 baseline, docs are updated, a CHANGELOG entry exists under a new minor version, and the migration was dogfooded end-to-end by a stable installed ridgeline binary driving this very spec.

## Features

### Phase 0 — Scaffold, dependencies, and baseline capture

Add fascicle (0.3.x) and zod (4.x — major version dictated by fascicle's peer-dependency) as runtime dependencies, bump engines.node from `>=20` to `>=24`, drop Node 20 from the CI matrix, create the new directory tree under src/engine/ (flows/, atoms/, composites/, adapters/) with empty index.ts files, and capture every pre-migration baseline that later phases verify against. Dependency versions are exact-pinned per the project's `.npmrc save-exact=true` convention; no caret/tilde range prefix is added or expected.

Acceptance criteria:
- package.json declares fascicle and zod under `dependencies` (not devDependencies); fascicle resolves to a 0.3.x version; zod resolves to a 4.x version (matching fascicle 0.3.x's required peer). Versions are exact-pinned (no `^` or `~` prefix) per `.npmrc save-exact=true`.
- package.json `engines.node` is `>=24`.
- package.json does NOT include `@ai-sdk/anthropic` or `ai` in dependencies, devDependencies, or peerDependencies.
- CI workflow files under .github/workflows/ contain no reference to `node-version: 20` or `node: 20`; only Node 24 (or 24+) is exercised.
- src/engine/{flows,atoms,composites,adapters}/ directories exist, each with an `index.ts` that re-exports nothing yet.
- Baseline artifacts captured under `.ridgeline/builds/fascicle-migration/baseline/`:
  - `help/<command>.txt` for `ridgeline --help` and every subcommand's `--help` output.
  - `dts/` containing the `tsc --emitDeclarationOnly` output of every src/commands/*.ts external function signature.
  - `fixtures/trajectory.jsonl`, `fixtures/state.json`, `fixtures/budget.json`, and `fixtures/phases/` from a recorded pre-migration build.
  - `fixtures/error-shapes.json` recording `error.name` and `error.message` for adversarial round-cap exhaustion, schema-validation failure, auth failure, and budget-exceeded paths.
  - `mutation-score.json` recording the Stryker mutation score on src/engine/pipeline/ at this commit. If the active sandbox blocks Stryker (greywall blocks the TCP-localhost IPC Stryker uses for child-proxy workers — EPERM on `internalConnectMultiple`), record `{ "score": null, "captured": false }` plus a documented unblock recipe (run outside greywall with `RIDGELINE_SANDBOX=0`, or `vitest pool: 'forks'` for `coverageAnalysis: 'perTest'`); the absolute pre-migration score is then captured at Phase 7 exit before the new-scope gate is asserted. The placeholder is acceptable for Phase 0 only.
  - `capability-matrix.md` recording the verified fascicle version and its claude_cli provider capabilities (sandbox kinds, auth modes, streaming events, cost reporting, AbortSignal propagation, model alias set, startup_timeout_ms, stall_timeout_ms, skip_probe).
- CHANGELOG.md contains a new entry under the next minor version (after 0.11.2) with at least three bullets: (1) `engines.node` bumped to `>=24` (BREAKING for consumers), prominently called out at the top of the entry; (2) internal substrate migration to fascicle; (3) public CLI behavior unchanged.
- `npm run check` is green; `ridgeline build` runs end-to-end against an existing build.

### Phase 1 — Trajectory, checkpoint, and budget adapters

Implement three ridgeline-side adapters in src/engine/adapters/ that conform to fascicle contracts: a TrajectoryLogger that writes to the existing `.ridgeline/builds/<name>/trajectory.jsonl` path translating fascicle TrajectoryEvent shapes into ridgeline's existing on-disk event schema; a CheckpointStore for per-step intra-run memoization scoped under `.ridgeline/builds/<name>/state/<step-id>.json`; and a budget subscriber that listens for cost events on `ctx.trajectory` and tallies them into budget.json. Wrap stores/trajectory.ts and stores/budget.ts so cost/event flow goes through `ctx.trajectory` while underlying file writers remain unchanged.

Acceptance criteria:
- src/engine/adapters/ contains exactly: `ridgeline_trajectory_logger.ts`, `ridgeline_checkpoint_store.ts`, `ridgeline_budget_subscriber.ts`, `index.ts`.
- ridgeline_trajectory_logger.ts has a top-of-file comment stating: `Translates fascicle TrajectoryEvent → ridgeline on-disk event shape (decision: translate, not verbatim — preserves fascicle-viewer and external .jsonl consumer back-compat).`
- A fixture-replay test loads `.ridgeline/builds/fascicle-migration/baseline/fixtures/trajectory.jsonl` and asserts the adapter's output for the same logical sequence is byte-equal for all event types that existed pre-migration.
- ridgeline_checkpoint_store.ts implements every method of fascicle's `CheckpointStore` interface (verified by `tsc` structural compatibility) and writes only under `.ridgeline/builds/<name>/state/<step-id>.json` — never under `.ridgeline/builds/<name>/state.json`.
- ridgeline_budget_subscriber.ts produces a budget.json whose `total_usd` field matches the sum of cost events to within 1e-9, and whose byte-output for a recorded fixture sequence is byte-equal to `.ridgeline/builds/fascicle-migration/baseline/fixtures/budget.json`.
- After Phase 1, `grep` for `recordCost(` and `logTrajectory(` in src/engine/ returns matches only in code that has been intentionally deferred for later phases; remaining direct call sites are tracked in `.ridgeline/builds/fascicle-migration/phase-1-deferred-callsites.md`.
- Adapter unit tests cover: append-only atomicity of trajectory.jsonl, checkpoint hit/miss across step retries, budget tally idempotency on duplicate cost events.
- `npm run check` green; `ridgeline build` runs end-to-end and produces a trajectory.jsonl that fascicle-viewer can render.

### Phase 2 — Sandbox policy builder and greywall parity

Replace src/engine/claude/sandbox.greywall.ts with src/engine/claude/sandbox.policy.ts exporting `buildSandboxPolicy(args): SandboxProviderConfig | undefined`. The function maps `--sandbox` flag values (`off | semi-locked | strict`) to fascicle's `{ kind: 'greywall', network_allowlist, additional_write_paths }` shape with no widening. Evaluate sandbox.ts and sandbox.types.ts for parallel reduction; preserve detection logic, remove spawn-wrapping types.

Acceptance criteria:
- src/engine/claude/sandbox.policy.ts exists; src/engine/claude/sandbox.greywall.ts no longer exists by Phase 2 exit.
- `buildSandboxPolicy` returns `undefined` for `sandboxFlag === 'off'`, and returns `{ kind: 'greywall', ... }` for `'semi-locked'` and `'strict'` — covered by unit tests.
- The default `network_allowlist` for `'semi-locked'` and `'strict'` is exported as a `const` and unit-tested for byte equality against a snapshot derived from the pre-migration sandbox.greywall.ts allowlist; no new entries appear without an explicit code-comment justification.
- `buildPath` is always present in `additional_write_paths`; per-build path resolution is unit-tested.
- All greywall integration tests in src/engine/__tests__/ that existed before Phase 2 pass unchanged at Phase 2 exit (verified by enumerating their test names from the Phase 0 baseline list and asserting each one passes).
- A new sandbox-parity regression test asserts the new policy yields enforcement equivalent to the legacy spawn wrapper for at least one network-blocked and one filesystem-blocked scenario.
- sandbox.ts and sandbox.types.ts are reduced to detection helpers and config types; an ast-grep rule flags `child_process` or `spawn` imports in those files.
- `npm run check` green; `ridgeline build` runs end-to-end with default sandbox enforcement.

### Phase 3 — Tier 1 composites

Implement exactly five Tier 1 composites in src/engine/composites/, each conforming to fascicle's `Step<i,o>` contract with abort propagation, trajectory event emission, and `ctx.on_cleanup` registration. No Tier 2 composites land in this phase. graph_drain and cost_capped are tagged in code comments as upstream-RFC candidates pending production exposure.

Acceptance criteria:
- src/engine/composites/ contains exactly: `phase.ts`, `graph_drain.ts`, `worktree_isolated.ts`, `diff_review.ts`, `cost_capped.ts`, `index.ts`.
- Each composite is exported as a function returning a `Step` and is decorated via `describe('<name>')` so trajectory events carry the composite name.
- Each composite has unit tests covering: (a) AbortSignal raised on `ctx` propagates to the inner Step within 100 ms; (b) at least one trajectory event with the composite name is emitted; (c) a registered `ctx.on_cleanup` handler runs on success, failure, and abort paths; (d) the expected error class and message surfaces on the failure path.
- phase composite test asserts that exhausting `maxRetries+1` unsuccessful rounds throws an error whose `.name` and `.message` match the snapshot in `.ridgeline/builds/fascicle-migration/baseline/fixtures/error-shapes.json`.
- phase exposes either an `archive_feedback` slot OR composes `adversarial_archived` — not both.
- graph_drain enforces a `concurrency: number` parameter; with `concurrency=2` and 4 ready nodes, no more than 2 inner Steps are active at any instant (verified by counting concurrent invocations in a stub).
- worktree_isolated default `merge_back='index_order'`: for 3 inner phases with input indices `[2, 0, 1]` running in parallel and all succeeding, the merge order recorded by a stub git driver is exactly `[0, 1, 2]` regardless of completion order. The stub deliberately stalls higher-index phases to prove completion order is ignored.
- cost_capped: emitting cumulative cost events `0.50, 0.95, 1.05` with `max_usd=1.00` results in the inner Step receiving an abort signal before the third event triggers a new model_call; cumulative budget can be exceeded by at most one in-flight step (this race semantics is documented in a top-of-file comment).
- diff_review preserves a build → commit → diff → review ordering verified by inspecting the trajectory event sequence.
- `npm run check` green; `ridgeline build` runs end-to-end (composites unused yet).

### Phase 4 — Atoms (model_call-based pipeline steps)

Replace src/engine/pipeline/*.exec.ts behavior with model_call-based atoms in src/engine/atoms/, alongside the existing pipeline (which stays compiling and operational until Phase 7). Each atom is `pipe(promptShaper, model_call({ engine, model, system, schema?, tools? }))` where `promptShaper` is src/engine/claude/stable.prompt.ts (preserved verbatim to maintain prompt-cache hit rate). Schema-bearing atoms pass ridgeline's existing Zod schemas to model_call so fascicle handles validation and `schema_repair_attempts`.

Acceptance criteria:
- src/engine/atoms/ contains exactly: `builder.atom.ts`, `reviewer.atom.ts`, `planner.atom.ts`, `specialist.atom.ts`, `refiner.atom.ts`, `researcher.atom.ts`, `specifier.atom.ts`, `sensors.collect.atom.ts`, `plan.review.atom.ts`, `specialist.verdict.atom.ts`, `index.ts`.
- Each atom file exports a `Step` and is importable from src/engine/atoms/index.ts.
- Zero atoms import from src/engine/pipeline/ or from src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types} (verified by grep).
- stable.prompt.ts is imported by every atom that calls model_call (verified by ast-grep).
- A byte-stability fixture test asserts that for a frozen `BuilderArgs` input, the `ModelCallInput` object passed into `model_call` is structurally identical (same keys, same string values, same array order) to the pre-migration `ModelCallInput` — protecting prompt-cache hit rate.
- Reviewer, planner, and specialist atom unit tests assert the `schema` parameter passed to `model_call` is the exact Zod schema imported from the existing schemas module (referential equality via the stub).
- Each atom has a vitest unit test under src/engine/atoms/__tests__/<atom>.test.ts using a stub Engine returning canned `GenerateResult` values; no test exercises the real claude_cli provider.
- An audit document `.ridgeline/builds/fascicle-migration/phase-4-tier2-audit.md` lists each Tier 2 composite candidate (with_stable_prompt, with_handoff, specialist_panel, adversarial_archived, resumable) with a counted call-site repetition number; only candidates with 3+ repetitions are promoted. Default outcome: no Tier 2 composites this migration.
- `capability-matrix.md` is re-verified at this phase against the pinned fascicle version's docs/source and any drift is recorded; mismatches block phase exit.
- Old src/engine/pipeline/*.exec.ts files remain in place, compile, and continue to run all existing E2E tests.
- `npm run check` green; `ridgeline build` runs end-to-end via the old pipeline.

### Phase 5 — Leaf command flows

Migrate every leaf command (every src/commands/<name>.ts except `build` and `auto`) to construct a fascicle flow and call `run(flow, input, opts)` inside a try/finally that disposes the Engine. External command signatures (the function exported from each commands/<name>.ts and consumed by src/cli.ts) and the CLI flag set are unchanged. The src/cli.ts manual `process.on('SIGINT', ...)` is NOT yet removed in this phase — it covers any commands still on the old surface.

Acceptance criteria:
- Each migrated command's entry point uses `makeRidgelineEngine(cfg)` wrapped in `try { await run(flow, input, opts) } finally { await engine.dispose() }`.
- An ast-grep rule flags any commands/*.ts that imports fascicle's `run` without a sibling `dispose()` call in the same function; adding such a file fails `npm run check`.
- Snapshot test of `ridgeline --help` and every subcommand's `--help` output is byte-equal to `.ridgeline/builds/fascicle-migration/baseline/help/<command>.txt`.
- External signatures of every commands/*.ts exported function are byte-equal to `.ridgeline/builds/fascicle-migration/baseline/dts/` — verified by re-running `tsc --emitDeclarationOnly` and diffing.
- Commands migrated in this phase: dry-run, research, plan, retro-refine, retrospective, qa-workflow, directions, design, shape, spec, ingest, refine, rewind. (catalog, check, clean, create, input, ui are inspected; if they don't invoke pipeline executors they are unchanged.)
- A `.ridgeline/builds/fascicle-migration/phase-5-plugin-surface-audit.md` enumerates every plugin call site that depends on a soon-to-be-deleted symbol (invokeBuilder, invokePlanner, invokeReviewer, runPhase, invokeClaude, parseStreamLine, createStreamHandler, extractResult, createDisplayCallbacks), with per-site disposition (`updated | removed | n/a`).
- Existing E2E tests for each migrated command pass unchanged.
- Tests targeting deleted internals are rewritten at the flow input/output layer in the same PR; the old → new mapping is recorded in the PR description so coverage isn't reduced.
- `npm run check` green; `ridgeline build` (still on old pipeline) and every migrated command run end-to-end.

### Phase 6 — Build flow, auto flow, and SIGINT handover

Migrate `build` and `auto` — the highest-complexity orchestrations — to fascicle flows that exercise every Tier 1 composite (phase, graph_drain, worktree_isolated, diff_review, cost_capped). Once every command runs through `run(flow, ...)`, remove the manual `process.on('SIGINT', ...)` handler in src/cli.ts and rely on fascicle's runner default `install_signal_handlers: true`. Migrate teardown to `ctx.on_cleanup(...)` registrations inside steps.

Acceptance criteria:
- src/commands/build.ts and src/commands/auto.ts are thin shells over fascicle flows defined in src/engine/flows/build.flow.ts and src/engine/flows/auto.flow.ts.
- src/engine/flows/ contains at minimum: `build.flow.ts`, `auto.flow.ts`, `plan.flow.ts`, `dryrun.flow.ts`, `research.flow.ts`, plus per-command flow files for every other migrated command.
- src/cli.ts contains zero matches for `process.on('SIGINT'` or `process.on("SIGINT"` (verified by grep).
- Every commands/*.ts call to `run(...)` either passes `install_signal_handlers: true` explicitly OR omits the key and relies on fascicle's default — and a unit test asserts fascicle's default for that key is `true` at the pinned fascicle version.
- An E2E test starts a `ridgeline build`, sends SIGINT after a configurable delay, and asserts: (a) process exit code === 130; (b) any created git worktrees have been removed; (c) no orphan claude subprocesses remain (verified by `ps` grep); (d) no "double cleanup" errors are logged.
- An E2E test resumes a `ridgeline build` after SIGINT via the existing state.json + tag-based outer resume path; resume continues to span processes (the CheckpointStore is per-step intra-run only and does not interfere).
- `ridgeline build --auto` against this build's `.ridgeline/builds/fascicle-migration/` directory completes successfully end-to-end, dogfooding the migration; the run is recorded in `.ridgeline/builds/fascicle-migration/dogfood-evidence.md` (trajectory excerpt + final state.json digest + timestamp).
- `npm run check` green.

### Phase 7 — Cleanup, deletions, docs, and mutation testing

Delete src/engine/pipeline/ in its entirety. Delete src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}.ts. Prune src/engine/index.ts public surface (invokeBuilder, invokePlanner, invokeReviewer, runPhase, invokeClaude, parseStreamLine, createStreamHandler, extractResult, createDisplayCallbacks); export the new flow + atom + composite + adapter + makeRidgelineEngine surface. Update affected plugin call sites in the same PR. Replace ridgeline's regex-based FATAL_PATTERNS / classifyError with instanceof checks against fascicle's typed errors. Update docs and CHANGELOG. Run scoped Stryker mutation testing.

Acceptance criteria:
- src/engine/pipeline/ directory does not exist on disk.
- src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}.ts do not exist on disk.
- After Phase 7, `grep` for each of these symbols across src/ returns zero matches: `invokeBuilder`, `invokePlanner`, `invokeReviewer`, `runPhase`, `invokeClaude`, `parseStreamLine`, `createStreamHandler`, `extractResult`, `createDisplayCallbacks`, `FATAL_PATTERNS`, `classifyError`.
- After Phase 7, `grep` for `src/engine/pipeline` and for the basenames `build.exec`, `phase.sequence`, `phase.graph`, `worktree.parallel`, `pipeline.shared` across src/ returns zero matches.
- src/engine/index.ts re-exports `makeRidgelineEngine` and at least one symbol from each of atoms/, composites/, adapters/, flows/.
- Affected plugin call sites enumerated in `phase-5-plugin-surface-audit.md` are updated in this PR; if any plugin relied on a now-deleted symbol with no equivalent, a thin StreamChunk reader replacement is provided OR the breakage is documented in CHANGELOG.md as a plugin-author-facing change.
- Retry policies use fascicle's `retry({ on_error })` where `on_error` returns true exactly for {`rate_limit_error`, `provider_error` when status ∈ 5xx or network, `on_chunk_error`} and false for {`aborted_error`, `engine_config_error`, `model_not_found_error`, `schema_validation_error`, `tool_approval_denied_error`, `provider_capability_error`, `provider_not_configured_error`, `tool_error`}; verified by a unit test that constructs each error class and calls `on_error`.
- A unit test asserts `aborted_error` always returns false from `on_error` regardless of any wrapping retry policy (it short-circuits all retry layers and propagates cancellation).
- User-facing error messages for auth, schema-validation, and budget-exceeded paths match `.ridgeline/builds/fascicle-migration/baseline/fixtures/error-shapes.json` (snapshot test).
- Stryker mutation testing scoped via `mutate` glob to `src/engine/{flows,atoms,composites,adapters}/**/*.ts` runs at Phase 7 exit (outside the sandbox if necessary). If the Phase 0 baseline `mutation-score.json` recorded `captured: false`, capture the absolute pre-migration score on src/engine/pipeline/ first, write it to the file, and assert the new-scope score is ≥ that number. Otherwise, assert directly against the recorded baseline.
- Each of the five composites has at least four unit tests covering abort, trajectory, cleanup, and error surfacing (verified by counting `test()` / `it()` calls per file).
- Each of the seven atoms has at least one unit test under src/engine/atoms/__tests__/<atom>.test.ts.
- docs/architecture.md, docs/build-lifecycle.md, docs/ensemble-flows.md, docs/extending-ridgeline.md, and docs/long-horizon.md each contain the literal phrase `fascicle` at least once and describe the shell+core layering.
- docs/extending-ridgeline.md contains a section heading matching `/atom|composite|flow|adapter/i` and a code example calling `makeRidgelineEngine`.
- docs/build-lifecycle.md describes the two-tier resume model: outer cross-process resume (state.json + git tags, owned by stores/state.ts) vs intra-run per-step memoization (fascicle CheckpointStore under .ridgeline/builds/<name>/state/<step-id>.json) — explicitly stating they never overlap.
- docs/long-horizon.md describes the trajectory-translation decision (fascicle event → ridgeline on-disk shape).
- CHANGELOG.md entry under the new minor version contains the three required bullets from Phase 0 plus a list of removed exports and the disposition of sandbox.ts/sandbox.types.ts.
- markdownlint and cspell pass on all updated docs.
- `npm run check` green.

### Engine factory and per-command lifecycle

A single canonical Engine constructor at src/engine/engine.factory.ts. Exactly one Engine per command invocation, disposed in a finally block. No command path constructs an Engine directly; only via the factory.

Acceptance criteria:
- src/engine/engine.factory.ts exports `makeRidgelineEngine(cfg: { sandboxFlag: 'off'|'semi-locked'|'strict', timeoutMinutes?: number, pluginDirs: string[], settingSources: string[], buildPath: string, networkAllowlistOverrides?: string[], additionalWritePaths?: string[] }): Engine`.
- An ast-grep rule asserts that fascicle's `create_engine` is imported only by src/engine/engine.factory.ts; any other file failing this rule blocks `npm run check`.
- A unit test using a mocked `create_engine` asserts the call receives `providers.claude_cli.auth_mode === 'auto'` (preserving subscription/OAuth, no ANTHROPIC_API_KEY required).
- A unit test asserts `providers.claude_cli.sandbox.kind === 'greywall'` for `sandboxFlag` values `'semi-locked'` and `'strict'`, and `providers.claude_cli.sandbox` is undefined (or `{ kind: 'none' }`) for `sandboxFlag === 'off'`.
- A unit test asserts `startup_timeout_ms === 120000` in the produced config.
- A unit test asserts `stall_timeout_ms === timeoutMinutes * 60_000` when `timeoutMinutes` is provided, and `=== 300000` when omitted; the mapping rule from `--timeout <minutes>` to two separate fascicle timeouts is documented in a top-of-file comment.
- A unit test asserts `skip_probe === true` when `process.env.VITEST === 'true'` and `false` otherwise.
- `pluginDirs` is computed via ridgeline's `discoverPluginDirs` exactly once per command invocation and threaded into the engine factory; `cleanupPluginDirs` runs after `engine.dispose()`. Order is verified by an integration test using spies.
- An E2E test asserts `engine.dispose()` is called on success, failure, and SIGINT paths.

### Twelve invariants — automated regression tests

Each of the twelve §7 invariants from shape.md is verified by at least one named automated test. Failures block phase merges. A checklist file `.ridgeline/builds/fascicle-migration/invariants.md` maps each invariant to its test file and test name.

Acceptance criteria:
- **Invariant 1 — Visible behavior unchanged**: CLI --help byte-equality test passes against Phase 0 baseline.
- **Invariant 2 — File-format stability**: state.json fixture loads and resumes; phases/<id>.md is byte-equivalent for a fixture prompt; trajectory.jsonl existing event types are byte-stable; budget.json totals match within 1e-9 USD.
- **Invariant 3 — Exit code preservation**: all non-zero exit codes match Phase 0 baseline including 130 on SIGINT.
- **Invariant 4 — Worktree merge order**: regression test stalls higher-index phases and asserts merge happens in phase-index order regardless of completion order.
- **Invariant 5 — SIGINT semantics**: post-Phase-6 only fascicle's handler is active; no double cleanup; worktrees and Claude subprocesses torn down once.
- **Invariant 6 — Cross-process resume**: state.json + tag-based outer resume continues to work; CheckpointStore is per-step intra-run only.
- **Invariant 7 — Sandbox enforcement parity**: pre-existing greywall integration tests pass unchanged.
- **Invariant 8 — Prompt-cache hit rate preserved**: stable.prompt.ts output is byte-stable for a frozen `ModelCallInput` fixture.
- **Invariant 9 — Sandbox allowlist not widened**: PR diff confirms no new entries in default `network_allowlist` or `additional_write_paths`.
- **Invariant 10 — Adversarial round-cap error shape**: error `.name` and `.message` match Phase 0 fixture for `maxRetries+1` exhaustion.
- **Invariant 11 — Budget cap aborts before exceeding**: cumulative ledger matches legacy; race semantics (at most one in-flight step exceeds) are documented and tested.
- **Invariant 12 — `npm run check` green at every phase exit**: per-phase `phase-<N>-check.json` snapshot under `.ridgeline/builds/fascicle-migration/` shows zero failures across types, lint, struct, agents, dead code, docs, spell, tests; `ridgeline build` operational at every phase exit.

### Test coverage and mutation testing scope

Existing tests under src/__tests__, src/engine/__tests__, src/stores/__tests__, src/commands/__tests__, and vitest.e2e.config.ts are carried forward. No existing test file is deleted without a same-PR replacement at the same abstraction level; each PR records the old → new mapping in its description. Net-new coverage targets the new layers.

Acceptance criteria:
- Each Tier 1 composite has ≥ 4 unit tests (abort, trajectory, cleanup, error surfacing).
- Each atom has ≥ 1 unit test using a stub Engine.
- Stryker config's `mutate` glob covers exactly `src/engine/{flows,atoms,composites,adapters}/**/*.ts` at Phase 7.
- Mutation score on the new scope is ≥ Phase 0 baseline mutation score on src/engine/pipeline/ (captured at Phase 7 if Phase 0's run was blocked by the active sandbox).
- vitest.e2e.config.ts is unchanged; existing E2E fixtures remain the primary regression net for §7 invariants.
- Test fixtures pass `skip_probe: true` to fascicle's claude_cli provider so unit tests don't make network probes.
- Snapshot tests for `ridgeline --help` and per-subcommand `--help` capture commander's output and assert byte equality against the Phase 0 baseline at every later phase exit.

### Terminal output and artifact format preservation

All TTY output and on-disk artifacts post-migration must match pre-migration output in styling, structure, and timing semantics. Streaming model output flows through fascicle's `claude_cli` provider StreamChunk events but renders identically to today's stream.display.ts behavior.

Acceptance criteria:
- A golden-file snapshot suite captures stdout/stderr for representative flows (a successful `ridgeline build`, a SIGINT mid-build, an adversarial retry, a budget-exceeded abort, a schema-validation failure) and asserts equality against Phase 0 baselines, normalized for: timestamps, run-IDs, build-paths, and ANSI cursor-position resets. Non-semantic timing differences in stream chunking are tolerated; visible-character sequences must match.
- No code under src/engine/{flows,atoms,composites,adapters}/ emits emoji to stdout or stderr (verified by an ast-grep rule that flags emoji literals in those paths).
- No new ANSI escape sequences, color codes, banners, or progress glyphs are introduced beyond what src/ui/* and the prior stream.display.ts emitted (verified by an ast-grep rule on `\[` and equivalent in new files).
- Streaming model output appears in the terminal in the same chunked cadence as today (token/line streaming preserved, not buffered to end-of-call) — verified by a recorded fixture or visual-inspection checklist.
- Tool-use blocks, thinking blocks, and final result blocks render with the same prefix, indentation, and separator lines as today.
- Inline cost tallies surfaced during a run match pre-migration formatting (currency symbol, precision, alignment) byte-for-byte for a fixed run.
- Non-TTY stdout (piped output, CI environments) preserves graceful degradation: no spinner frames, no color codes when `NO_COLOR` is set, no color codes when stdout is not a TTY; `FORCE_COLOR` continues to override.
- stderr vs stdout splitting is preserved: error messages and fatal diagnostics go to stderr; non-error progress and result output go to stdout; the splitting rules match pre-migration (verified by snapshot tests that capture both streams independently).
- New diagnostic events introduced by the migration go through `ctx.trajectory.emit(...)` rather than direct `console.log/error` or `process.stdout/stderr.write`. User-facing error messages already routed to stderr continue to be routed to stderr through the existing path. An ast-grep rule flags new `console.*` or `process.stderr.write` calls in src/engine/{flows,atoms,composites,adapters}/.
- phases/<id>.md, handoff files, feedback files, and tag formats are byte-equivalent to Phase 0 fixtures for the same logical inputs.
- New ridgeline-emitted trajectory event types use camelCase; fascicle-emitted event types retain snake_case as fascicle emits them.

### Naming-convention boundary visibility

The snake_case (fascicle) vs camelCase (ridgeline) boundary is explicit and visible at every call site. No alias re-exports hide the boundary.

Acceptance criteria:
- Fascicle imports retain their original snake_case identifiers at every call site (`create_engine`, `model_call`, `run`, `sequence`, `parallel`, `branch`, `map`, `retry`, `fallback`, `timeout`, `loop`, `adversarial`, `ensemble`, `tournament`, `consensus`, `checkpoint`, `suspend`, `scope`, `stash`, `use`, `describe`, `tee_logger`, `filesystem_logger`, `aborted_error`, `rate_limit_error`, `provider_error`, `schema_validation_error`, etc.).
- An ast-grep rule flags any `export ... as <camelCaseName>` re-export of a fascicle-snake_case symbol.
- Ridgeline-side identifiers use camelCase. Booleans use is/has/should prefixes (e.g., `isMerged`, `hasCheckpoint`, `shouldRetry`) — enforced by ast-grep where practical, otherwise by code review.
- The engine factory function is named `makeRidgelineEngine` (camelCase, ridgeline-side) even though it builds a fascicle Engine.

## In Scope

- Adding fascicle (0.3.x) and zod (4.x — major version dictated by fascicle's peer-dependency) as runtime dependencies, exact-pinned per `.npmrc save-exact=true`; bumping `engines.node` from `>=20` to `>=24`; updating CI matrix to drop Node 20.
- New directory tree under src/engine: `flows/`, `atoms/`, `composites/`, `adapters/`, plus `engine.factory.ts` and `claude/sandbox.policy.ts`.
- Engine factory `makeRidgelineEngine(cfg)` calling fascicle's `create_engine` with a `claude_cli` provider configured for greywall sandbox + `auth_mode: 'auto'` + plugin_dirs + setting_sources + startup_timeout_ms + stall_timeout_ms + skip_probe (under vitest).
- Exactly one Engine per command invocation, disposed in a `try { ... } finally { await engine.dispose() }` block at the command entry point.
- Replacing src/engine/pipeline/*.exec.ts behavior with model_call-based atoms in src/engine/atoms/; deleting src/engine/pipeline/ at Phase 7.
- Deleting src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}.ts at Phase 7.
- Rewriting src/engine/claude/sandbox.greywall.ts as src/engine/claude/sandbox.policy.ts producing `SandboxProviderConfig`; reducing sandbox.ts/sandbox.types.ts to detection helpers.
- Five Tier 1 composites in src/engine/composites/: phase, graph_drain, worktree_isolated, diff_review, cost_capped — each conforming to fascicle's `Step<i,o>` contract.
- Three adapters in src/engine/adapters/: ridgeline_trajectory_logger (translates fascicle TrajectoryEvent → ridgeline on-disk shape), ridgeline_checkpoint_store (per-step intra-run memoization under .ridgeline/builds/<name>/state/), ridgeline_budget_subscriber.
- Migrating every command in src/commands/ that invokes a pipeline executor to construct a fascicle flow and call `run(flow, input, opts)` with engine.dispose() in finally; external command signatures unchanged; CLI flag set unchanged.
- Replacing FATAL_PATTERNS / classifyError with instanceof checks against fascicle's typed error classes; preserving existing exponential-backoff-with-jitter retry defaults.
- Wrapping stores/budget.ts and stores/trajectory.ts so cost/event flow goes through `ctx.trajectory`; underlying file writers unchanged.
- Removing the manual `process.on('SIGINT', ...)` handler in src/cli.ts; relying on fascicle's `install_signal_handlers` default; migrating teardown to `ctx.on_cleanup` registrations; preserving exit code 130.
- Deleting old public surface in src/engine/index.ts at Phase 7 and updating affected plugin call sites in the same PR; providing a thin StreamChunk reader replacement only if a load-bearing plugin consumer requires it.
- Carrying forward all existing tests; rewriting tests targeting deleted internals at the same abstraction level; recording old → new test mapping in PR descriptions.
- Adding unit tests for each Tier 1 composite (≥ 4 each) and each atom (≥ 1 each).
- Configuring scoped Stryker mutation testing over `src/engine/{flows,atoms,composites,adapters}/**/*.ts` at Phase 7; mutation score ≥ Phase 0 baseline.
- Updating docs/architecture.md, docs/build-lifecycle.md, docs/ensemble-flows.md, docs/extending-ridgeline.md, docs/long-horizon.md.
- Adding a CHANGELOG entry under a new minor version with a prominent BREAKING-FOR-CONSUMERS callout for the Node 24 bump.
- Translating fascicle TrajectoryEvent shapes into ridgeline's existing on-disk .jsonl event schema (decision: translate, not verbatim).
- Mapping `--sandbox` flag values (`off | semi-locked | strict`) to `network_allowlist` + `additional_write_paths` via the policy builder; per-build path resolution made explicit.
- Mapping `--timeout <minutes>` to `claude_cli`'s `startup_timeout_ms` and `stall_timeout_ms` in the engine factory.
- Coordinating `plugin_dirs` / `setting_sources` with `discoverPluginDirs` / `cleanupPluginDirs` lifecycle without double-discovery.
- Capturing Phase 0 baseline artifacts under `.ridgeline/builds/fascicle-migration/baseline/`: --help snapshots, .d.ts snapshots, trajectory/state/budget/phases fixtures, error-shape snapshots, mutation-score baseline, claude_cli capability matrix.
- Phase exit gates: each phase produces at least one commit on the fascicle branch (the ridgeline builder loop names its own commits — no specific subject prefix is required) and captures `.ridgeline/builds/fascicle-migration/phase-<N>-check.json` containing the `.check/summary.json` snapshot. The check-JSON artifact is the canonical phase-exit signal; commit subject formatting is not part of the gate.
- Dogfood evidence: `ridgeline build --auto` driven by a separately installed stable ridgeline binary against a worktree of main, recorded in `.ridgeline/builds/fascicle-migration/dogfood-evidence.md` as a Phase 6 exit gate.
- Plugin surface audit: `.ridgeline/builds/fascicle-migration/phase-5-plugin-surface-audit.md` enumerates every consumer of soon-to-be-deleted exports before Phase 7 deletion.

## Out of Scope

- Any redesign — externally observable behavior of ridgeline must not change.
- Rewriting agents, prompts, planners, reviewers, or specialists.
- Migrating input/output file formats (spec/constraints/taste/design loading, state.json schema beyond additive optional fields, phases/<id>.md format, feedback files, tags, .jsonl trajectory shape for existing event types, budget ledger format).
- Changing the public engine exports in src/engine/index.ts before Phase 7 cleanup.
- Changing the CLI flag set; renaming flags; deprecating flags; adding new flags.
- Upstreaming graph_drain or cost_capped to fascicle in this migration (flagged for follow-up RFCs only).
- Adding direct Anthropic API access via the anthropic provider; `@ai-sdk/anthropic` and `ai` are not added.
- Tier 2 composites (`with_stable_prompt`, `with_handoff`, `specialist_panel`, `adversarial_archived`, `resumable`) unless Phase 4's audit reveals 3+ call-site repetitions of the same imperative pattern; default outcome is no Tier 2 composites.
- Migrating any Tier 2 composite candidates upstream or generalizing them across multiple harnesses.
- Changes to ridgeline's plugin loading model beyond updating the call sites broken by Phase 7 surface deletions.
- New UI, dashboard, viewer, or graphical surface; no redesign of fascicle-viewer or its rendered output.
- New color palette, typography, iconography, layout system, print artifact, game asset, sprite, or HUD work.
- Adding emoji, banners, ANSI styles, or progress glyphs to terminal output.
- Changes to existing trajectory.jsonl event shapes for existing event types; emitting fascicle TrajectoryEvent verbatim to .jsonl is explicitly out of scope.
- Performance work or new performance budgets beyond preserving currently observed behavior; the migration must not regress prompt-cache hit rate, but no positive performance target is set.
- Widening sandbox allowlists as a side effect of migration; introducing new credential surfaces or auth flows.
- Cross-version concurrent-build safety beyond preserving current behavior; if pre-migration ridgeline has a race, the migration is not required to fix it.
- Markdown diagram additions (Mermaid, images) to docs if they are not already present in the docs/ tree.
- Responsive breakpoints, hover/focus/active/disabled states, animation behavior, WCAG/axe-core/accessibility verification — not applicable (no UI surface).
