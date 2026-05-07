# fascicle-migration

## Intent

Replace ridgeline's hand-rolled orchestration (sequence, retry, parallel, adversarial, checkpoint, abort, trajectory, budget) with fascicle's primitive set, while keeping ridgeline a distinct application with its own CLI, domain logic, file formats, and extensions. The migration moves orchestration plumbing into fascicle (the "core") while preserving every ridgeline-specific behavior as a shell — CLI surface, state.json/phases/feedback/tags/trajectory/budget on-disk formats, sandbox policy, prompts, sensors, agents, and UI. Visible behavior must not change; the win is ~95% reduction in orchestration LOC and a substrate that future ridgeline features (and other harnesses) can build on.

## Scope

Size: large

Boundaries:

**In scope:**
- Add fascicle (and zod) as runtime dependencies; bump engines.node from >=20 to >=24 and update CI matrix
- Introduce new directory tree under src/engine: flows/, atoms/, composites/, adapters/
- Build a shared engine factory make_ridgeline_engine() that calls fascicle's create_engine with a claude_cli provider configured for greywall sandbox + auto auth + plugin_dirs + setting_sources, disposed per command invocation
- Replace src/engine/pipeline/*.exec.ts (build, plan, ensemble, review, refine, research, specify, sensors.collect, plan.review, specialist.verdict) with model_call-based atoms + flows
- Delete src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}.ts in favor of fascicle's claude_cli provider and StreamChunk events
- Rewrite src/engine/claude/sandbox.greywall.ts as a policy builder that produces a SandboxProviderConfig (no spawn wrapping); evaluate sandbox.ts/sandbox.types.ts for parallel reduction
- Implement Tier 1 ridgeline-side composites in src/engine/composites/: phase, graph_drain, worktree_isolated, diff_review, cost_capped — each conforming to fascicle's Step<i,o> contract with abort propagation, trajectory events, and cleanup registration
- Implement ridgeline-side adapters: TrajectoryLogger writing to existing .jsonl path (composed via tee_logger), CheckpointStore for per-step memoization under .ridgeline/builds/<name>/state/, and a budget subscriber that tallies cost events into budget.json
- Migrate every command in src/commands/ (dry-run, research, plan, build, auto, retro-refine, retrospective, qa-workflow, directions, design, shape, spec, ingest, refine, rewind) to construct a fascicle flow and call run(flow, input, opts); external command signatures unchanged
- Replace ridgeline's regex-based error classification (FATAL_PATTERNS, classifyError) with instanceof checks against fascicle's typed errors (rate_limit_error, provider_error, engine_config_error, schema_validation_error, etc.) inside retry policies
- Wrap stores/budget.ts and stores/trajectory.ts so cost/event flow goes through ctx.trajectory rather than direct recordCost/logTrajectory call sites; keep underlying file writers
- Remove the manual process.on('SIGINT', ...) in src/main.ts once fascicle's runner default install_signal_handlers handles abort + cleanup; migrate teardown to ctx.on_cleanup registrations
- Replace src/engine/index.ts public surface in the cleanup phase: delete invokeBuilder/invokePlanner/invokeReviewer/runPhase/invokeClaude/parseStreamLine/createStreamHandler/extractResult/createDisplayCallbacks; export the new flow + atom surface; surface plugin breakage and update affected call sites in the same PR
- Carry forward all existing tests in src/__tests__, src/engine/__tests__, src/stores/__tests__, src/commands/__tests__, vitest.e2e.config.ts; rewrite tests targeting deleted internals to target new flow inputs/outputs at the same abstraction level
- Add unit tests for each Tier 1 composite (abort propagation, trajectory event emission, cleanup registration, error surfacing) and for each atom (with stub Engine returning canned GenerateResult values)
- Run scoped Stryker mutation testing over the new flows/ and atoms/ directories at Phase 6 exit
- Update docs/architecture.md, docs/build-lifecycle.md, docs/ensemble-flows.md, docs/extending-ridgeline.md to describe the shell+core layering
- Add a CHANGELOG entry under a new minor version describing the internal migration

**Out of scope:**
- Any redesign — visible behavior of ridgeline must not change
- Rewriting agents, prompts, planners, reviewers, or specialists
- Migrating input/output file formats (spec/constraints/taste/design loading, state.json, phases/*.md, feedback files, tags, .jsonl trajectory shape, budget ledger)
- Changing the public engine exports in src/engine/index.ts until the final cleanup phase — old surface stays compiling while call sites migrate one at a time
- Changing the CLI flag set
- Upstreaming ridgeline-specific composites (graph_drain, cost_capped) to fascicle in this pass — flagged for follow-up RFCs only
- Adding direct Anthropic API access via the anthropic provider; @ai-sdk/anthropic + ai peer deps are not added in this migration
- Tier 2 composites (with_stable_prompt, with_handoff, specialist_panel, adversarial_archived, resumable) — only land if Phase 4 reveals 3+ repetitions
- [inferred] Migrating Tier 2 composite candidates upstream or generalizing them across multiple harnesses
- [inferred] Changes to ridgeline's plugin loading model beyond updating any plugin call sites broken by Phase 6 surface deletions

## Solution Shape

Refactor ridgeline into a shell+core architecture: ridgeline keeps its CLI, commands, stores (state, phases, tags, handoff, feedback, settings, inputs, budget, trajectory), sandbox policy, prompts, agents, sensors, UI, catalog, shapes, references, and worktree primitives; fascicle becomes the orchestration core (run, sequence, parallel, branch, map, retry, fallback, timeout, loop, adversarial, ensemble, tournament, consensus, checkpoint, suspend, scope/stash/use, model_call, claude_cli provider, trajectory/checkpoint contracts). The canonical call shape is a per-command Engine built via create_engine({ providers: { claude_cli: { auth_mode: 'auto', sandbox: { kind: 'greywall', network_allowlist, additional_write_paths }, plugin_dirs, setting_sources } } }), each pipeline step expressed as an atom (pipe(promptShaper, model_call({ engine, model, system, schema?, tools? }))), and the whole command invoked via run(flow, input, { trajectory, checkpoint_store, install_signal_handlers }) inside a try/finally that disposes the engine. Five Tier 1 composites bridge ridgeline patterns onto fascicle primitives: phase (checkpoint + adversarial + feedback archival + round cap), graph_drain (DAG ready-set traversal with bounded concurrency), worktree_isolated (git worktree scoping with deterministic index-order merge), diff_review (build → commit → diff → review chain), cost_capped (trajectory-subscribed budget cap with fine-grained abort). The migration unfolds in seven safe-self-bootstrap phases (Scaffold → Adapters → Composites → Atoms → Leaf flows → Build flow → Auto + remaining → Cleanup), each ending with npm run check green and ridgeline build still working; the binary executing the migration is a separately installed stable ridgeline operating on a worktree of main, never the binary under migration. Done means src/engine/pipeline is deleted, src/engine/claude/{claude.exec,stream.*}.ts are deleted, all twelve invariants in §7 verified by automated tests, every command runs through run(flow, input, opts), Tier 1 composites have isolated unit tests + E2E coverage, mutation testing scoped to new code passes, docs are updated, and the migration was dogfooded end-to-end by ridgeline build --auto driving this very spec.

## Risks & Complexities

- Node version bump from >=20 to >=24 forces ridgeline consumers to upgrade; CHANGELOG must call this out and CI matrix must drop Node 20 in Phase 0
- Naming-convention boundary: fascicle uses snake_case (create_engine, model_call, tee_logger, aborted_error) while ridgeline uses camelCase (isMerged-style booleans). Rule: ridgeline-side identifiers stay camelCase, fascicle imports keep snake_case, no alias re-exports — boundary visible at call sites
- engine.dispose() ownership: one Engine per command invocation, built via make_ridgeline_engine(cfg), disposed in finally at the command entry point — easy to leak if a command path skips the wrapper
- claude_cli provider capability matrix must be re-verified against fascicle's current docs before Phase 4: sandbox kinds, auth modes, streaming events, cost reporting, AbortSignal propagation, model alias set (cli-sonnet/cli-opus/cli-haiku), startup_timeout_ms vs ridgeline's --timeout <minutes>, skip_probe for tests
- Trajectory event shape decision in Phase 1: write fascicle's TrajectoryEvent verbatim (breaks backward-compat with existing .jsonl consumers including fascicle-viewer integration assumptions) versus translate to ridgeline's existing schema. If verbatim, docs/long-horizon.md and external consumers must update
- Plugin compatibility: src/engine/index.ts is consumed by plugins via plugin/ discovery. parseStreamLine/createStreamHandler/extractResult disappear with claude.exec.ts — must enumerate which exports are load-bearing before Phase 6 deletion and surface a thin StreamChunk reader replacement if needed
- Worktree merge order invariant (§7.4): when a wave of N phases runs in parallel and all pass, they must merge into the parent in phase index order, not completion order — worktree_isolated's default merge_back='index_order' must be exercised by a regression test
- SIGINT behavior invariant (§7.5): once fascicle's install_signal_handlers default takes over, ridgeline's existing process.on('SIGINT', ...) must be removed cleanly — leaving both in place risks double-cleanup or orphan worktrees/tags; exit code 130 must be preserved
- Adversarial round cap invariant (§7.10): a phase that hits maxRetries+1 unsuccessful rounds must fail with the same error shape as today — fascicle's adversarial wrapper must surface a comparable error type or be wrapped in phase composite to translate
- Resume invariant (§7.11): ridgeline's outer state.json + tag-based resume spans processes; fascicle's checkpoint is per-step intra-run memoization. The two must coexist without confusion — outer resume logic stays in stores/state.ts, fascicle CheckpointStore only handles per-step memo
- Greywall enforcement invariant (§7.9): the existing greywall integration tests must pass at Phase 2 exit — the policy builder rewrite must produce a SandboxProviderConfig that yields the same enforcement as the current spawn wrapper
- Tier 1 composites are net-new contracts ridgeline must maintain; graph_drain and cost_capped are flagged as upstream candidates but stay ridgeline-side until exercised in production
- Self-bootstrap risk: the migration must be runnable by ridgeline itself, so each phase must leave npm run check green and ridgeline build operational — pulling out substrate the running build relies on is the failure mode this ordering is designed to avoid
- [inferred] Coordinating the engine factory's plugin_dirs and setting_sources with ridgeline's discoverPluginDirs/cleanupPluginDirs lifecycle — currently those are owned by ridgeline; fascicle's expectations need to be matched without double-discovery
- [inferred] Mapping ridgeline's --sandbox flag values (off | semi-locked | strict) to greywall's network_allowlist + additional_write_paths shape may surface gaps where current ridgeline behavior is implicit (e.g. per-build path resolution) that the policy builder must make explicit

## Existing Landscape

Mature TypeScript Node CLI at v0.11.2, currently engines.node>=20, ESM modules, oxlint + ast-grep + agnix + fallow + cspell + markdownlint + Stryker + Vitest tooling, npm run check pipeline as the single source of truth. Project layout: src/main.ts entry; src/commands/* houses 19 subcommand files (auto, build, catalog, check, clean, create, design, directions, dry-run, ingest, input, plan, qa-workflow, refine, research, retro-refine, retrospective, rewind, shape, spec, ui, plus index); src/engine/ contains pipeline/ (15 *.exec.ts and orchestration files including build.exec, ensemble.exec, phase.graph, phase.sequence, plan.exec, plan.review, refine.exec, research.exec, review.exec, sensors.collect, specialist.verdict, specify.exec, worktree.parallel, prompt.document, pipeline.shared), claude/ (claude.exec.ts, stream.parse/result/display/types.ts, sandbox.ts, sandbox.greywall.ts, sandbox.types.ts, stable.prompt.ts, agent.prompt.ts), discovery/, detect/, worktree.ts, and index.ts re-exporting invokeBuilder/invokeClaude/runPhase/invokePlanner/invokeReviewer/parseStreamLine/createStreamHandler/extractResult/createDisplayCallbacks plus discovery helpers. Stores layer: state.ts, phases.ts, tags.ts, handoff.ts, settings.ts, inputs.ts, budget.ts, trajectory.ts, feedback.{format,io,parse,verdict}.ts. Domain layers kept verbatim: agents/, sensors/, ui/, catalog/, shapes/, references/. Existing build artifacts at .ridgeline/builds/fascicle-migration/ contain seed.md, state.json, phases/. CLAUDE.md mandates running npm run check after every task and following its design philosophy of optimizing the happy path while keeping modules composable with full interfaces.

**External dependencies:**
- fascicle (npm) — pinned to current 0.3.x at time of writing; provides composition primitives (step, sequence, parallel, branch, map, pipe, retry, fallback, timeout, loop, compose, checkpoint, suspend, scope, stash, use, describe), composites (adversarial, ensemble, ensemble_step, consensus, tournament, improve, learn, bench, judge_*), engine (create_engine, model_call, forward_standard_env), runner (run, run.stream), errors (aborted_error, engine_config_error, model_not_found_error, provider_error, provider_capability_error, provider_not_configured_error, rate_limit_error, schema_validation_error, tool_error, tool_approval_denied_error, on_chunk_error), adapters (filesystem_logger, http_logger, noop_logger, tee_logger, filesystem_store), and viewer (start_viewer, run_viewer_cli, fascicle-viewer bin)
- fascicle/adapters subpath — for filesystem_logger, http_logger, noop_logger, tee_logger, filesystem_store; TrajectoryLogger and CheckpointStore contracts re-exported from fascicle root
- zod — fascicle peer dep used for ridgeline's review_verdict, plan_artifact, specialist_verdict schemas passed to model_call({ schema })
- @ai-sdk/anthropic + ai — NOT added in this migration; only relevant if a future direct-API route is taken
- claude_cli provider (built into fascicle) — owns the Claude subprocess spawn, greywall/bwrap sandbox kinds, auth modes (auto | oauth | api_key), plugin_dirs, setting_sources, default_cwd, startup_timeout_ms, stall_timeout_ms, skip_probe
- fascicle-viewer — long-running observability dashboard available as a bin and as start_viewer/run_viewer_cli imports; consumes the trajectory .jsonl
- Existing tooling unchanged: oxlint 1.58.0, ast-grep 0.42.1, agnix 0.17.0, fallow 2.13.0, cspell 10.0.0, markdownlint-cli2 0.21.0, vitest 4.1.2, @stryker-mutator/core 9.6.1, typescript 5.9.3, commander 13.0.0 (kept for CLI), playwright (optional peer)
- [inferred] Anthropic prompt-cache behavior — ridgeline's stable.prompt.ts shapes the ModelCallInput passed to model_call to maximize cache hits; depends on fascicle preserving the prompt structure it receives

**Data structures:**
- state.json — outer build resume contract under .ridgeline/builds/<name>/; existing shape must load and resume after migration; new fields must be optional with migration defaults
- phases/<id>.md — phase output files; format unchanged; readable by both old and new ridgeline
- feedback files — archived between adversarial rounds; preserved on disk
- tags — git tag-based checkpoints used for outer resume; ridgeline owns the lifecycle
- trajectory .jsonl — event stream consumed by fascicle-viewer and ridgeline UI; same path, same event shape; new event types may be added but existing ones must not change
- budget.json — cumulative cost ledger; totals must match what the previous implementation would have written
- handoff files — inter-stage I/O contract (directions → design → spec → plan → build) owned by stores/handoff.ts
- review_verdict, plan_artifact, specialist_verdict — ridgeline-domain Zod schemas passed to model_call({ schema }) so fascicle handles validation and schema_repair_attempts
- Engine, EngineConfig, GenerateResult, Tool, StreamChunk, RetryPolicy, EffortLevel, Message, UsageTotals — fascicle types touching ridgeline's atoms and adapters
- Step<i,o> — fascicle's primitive contract that ridgeline's Tier 1 composites must conform to (named display, ctx plumbing, abort-aware)
- RunContext (ctx) — carries trajectory, abort signal, on_cleanup registry, and scope/stash/use bindings through every composer
- TrajectoryLogger and CheckpointStore — fascicle contracts ridgeline implements as adapters
- SandboxProviderConfig — { kind: 'greywall', network_allowlist, additional_write_paths } value produced by ridgeline's policy builder
- PhaseResult<candidate>, AdversarialBuildInput, AdversarialCritiqueResult — types around the phase composite
- [inferred] BuilderArgs, ModelCallInput — ridgeline-side input types feeding the prompt-shaper step before model_call

**Relevant modules:**
- src/main.ts — entry; remove manual SIGINT handler once fascicle install_signal_handlers covers every command
- src/commands/*.ts — every file becomes a thin shell: build flow, run(flow, input, opts), engine.dispose() in finally; external signatures unchanged
- src/engine/index.ts — incremental REPLACE; old re-exports stay compiling until call sites migrate, final pass deletes invokeBuilder/invokePlanner/invokeReviewer/runPhase/invokeClaude/parseStreamLine/createStreamHandler/extractResult/createDisplayCallbacks
- src/engine/pipeline/*.ts (build.exec, plan.exec, ensemble.exec, review.exec, refine.exec, research.exec, specify.exec, plan.review, sensors.collect, specialist.verdict, phase.sequence, phase.graph, worktree.parallel, prompt.document, pipeline.shared) — DELETE entire directory at Phase 6
- src/engine/claude/claude.exec.ts (~293 LOC) — DELETE; fascicle's claude_cli provider owns the spawn
- src/engine/claude/stream.{parse,result,display,types}.ts — DELETE; fascicle's typed StreamChunk events replace stream parsing
- src/engine/claude/sandbox.greywall.ts — REWRITE as buildSandboxPolicy(cfg): SandboxProviderConfig; may be deletable if trivial
- src/engine/claude/sandbox.ts, sandbox.types.ts — KEEP or REWRITE; sandbox detection logic likely stays, spawn-wrapping types go
- src/engine/claude/stable.prompt.ts — KEEP; shapes ModelCallInput for prompt-cache hits
- src/engine/claude/agent.prompt.ts — KEEP; domain prompt assembly used by atoms
- src/engine/discovery/* — KEEP (agent.scan, agent.registry, plugin.scan)
- src/engine/detect/* — KEEP (project type detection)
- src/engine/worktree.ts — KEEP; primitives consumed by worktree_isolated composite
- src/engine/flows/ — NEW directory with build.flow.ts, plan.flow.ts, dryrun.flow.ts, auto.flow.ts, research.flow.ts, plus per-command flow files
- src/engine/atoms/ — NEW directory with builder.atom, reviewer.atom, planner.atom, specialist.atom, refiner.atom, researcher.atom, specifier.atom — each a Step from model_call(...)
- src/engine/composites/ — NEW directory: phase.ts, graph_drain.ts, worktree_isolated.ts, diff_review.ts, cost_capped.ts (Tier 1); Tier 2 only if patterns repeat
- src/engine/adapters/ — NEW directory: ridgeline_trajectory_logger, ridgeline_checkpoint_store, ridgeline_budget_subscriber
- src/stores/state.ts — KEEP outer resume; fascicle CheckpointStore only does per-step memoization
- src/stores/budget.ts — WRAP; cost events flow through ctx.trajectory; subscriber tallies into budget.json; replaces explicit recordCost calls
- src/stores/trajectory.ts — WRAP into a TrajectoryLogger adapter writing to existing .jsonl; compose with tee_logger if a second sink is needed
- src/stores/{phases,tags,handoff,feedback.format,feedback.io,feedback.parse,feedback.verdict,settings,inputs}.ts — KEEP
- src/agents/*, src/sensors/*, src/ui/*, src/catalog/*, src/shapes/*, src/references/* — KEEP
- src/git.ts — KEEP; worktree creation/merge ordering rules ridgeline owns
- package.json — EDIT: add fascicle and zod runtime deps; bump engines.node to >=24; remove commander-adjacent stream-parsing helpers ridgeline used for claude.exec.ts once gone
- tsconfig.json — EDIT: confirm target/lib settle on Node 24 baseline
- vitest.e2e.config.ts — UNCHANGED; existing E2E fixtures remain the primary regression net for invariants
- scripts/check.mjs — UNCHANGED; npm run check must remain green at every phase exit
- docs/architecture.md, docs/build-lifecycle.md, docs/ensemble-flows.md, docs/extending-ridgeline.md, docs/long-horizon.md — UPDATE in Phase 6 cleanup
- CHANGELOG.md — UPDATE under a new minor version entry

## Technical Preferences

- **Error handling:** Replace ridgeline's regex-based FATAL_PATTERNS / classifyError with instanceof checks against fascicle's typed error classes (rate_limit_error, provider_error, provider_capability_error, provider_not_configured_error, engine_config_error, model_not_found_error, schema_validation_error, tool_error, tool_approval_denied_error, on_chunk_error, aborted_error). Network errors, rate limits, and 5xx are retried via fascicle's retry({ max_attempts, backoff_ms, on_error }) with the existing exponential-backoff-plus-jitter defaults. Auth errors, schema-violation errors, and budget-exceeded abort the build. The cost_capped composite subscribes to cost events on ctx.trajectory and aborts the inner step's controller when cumulative cost exceeds max_usd. SIGINT/SIGTERM handling moves to fascicle's runner default (install_signal_handlers: true); the existing process.on('SIGINT', ...) in src/main.ts is removed; cleanup moves to ctx.on_cleanup(...) registrations inside steps so worktrees are torn down and Claude subprocesses are killed deterministically. The adversarial round cap must surface the same error shape as today when a phase exhausts maxRetries+1 unsuccessful rounds. Exit code 130 on SIGINT is preserved.
- **Performance:** Fascicle's substrate is expected to be at least as fast as the current implementation; orchestration LOC is projected to drop ~95%. Prompt-cache hit rate must be preserved by keeping stable.prompt.ts as the ModelCallInput shaper for every model_call step. Concurrency control for parallel waves uses graph_drain's bounded concurrency parameter (matching ridgeline's current wave-loop semantics). Budget caps are checked on every cost event via cost_capped (finer-grained than the current per-wave check) and abort the build before initiating a step that would exceed --max-budget-usd. claude_cli timeouts (startup_timeout_ms ~120s, stall_timeout_ms ~300s) must be mapped from ridgeline's --timeout <minutes> flag in the engine factory. [inferred] No new performance budgets are imposed beyond preserving current observed behavior.
- **Security:** Greywall sandbox enforcement is non-negotiable: the Claude subprocess never escapes the greywall allowlist, verified by the existing greywall integration tests at Phase 2 exit. Fascicle owns the mechanism (sandbox: { kind: 'greywall', network_allowlist, additional_write_paths } in claude_cli provider config); ridgeline owns the policy (--sandbox flag mapping off | semi-locked | strict, default allowlists, per-build path resolution) via a small policy builder. Auth defaults to claude_cli's auto mode so subscription auth works without ANTHROPIC_API_KEY (per user memory: subscription/OAuth, not API key). Sensitive considerations: no widening of the sandbox allowlist as a side effect of the migration; the policy builder must produce a SandboxProviderConfig that yields enforcement equivalent to the current spawn wrapper. [inferred] No new credential surfaces are introduced.
- **Trade-offs:** Strongly favor preserving visible behavior over internal elegance — the migration is a substrate swap, not a redesign. Favor incremental migration over a big bang: each of the seven phases must end with npm run check green and ridgeline build operational, and the migration must be runnable by ridgeline itself (executed by a separately installed stable binary against a worktree of main, never the binary under migration). Favor keeping ridgeline-specific composites ridgeline-side first; only flag graph_drain and cost_capped as upstream candidates after they have been exercised in production. Favor the simplest path that works at the boundary while preserving fascicle's full primitive surface internally — fold universal features into defaults, not flags (per repo CLAUDE.md). Pick phase's archive_feedback slot OR adversarial_archived as a Tier 2 decorator, not both. Tier 2 composites only land if Phase 4 reveals 3+ repetitions; otherwise leave imperative.
- **Style:** Naming-convention boundary is explicit and visible at call sites: fascicle imports stay snake_case (create_engine, model_call, tee_logger, aborted_error, run, sequence, parallel); ridgeline-side identifiers stay camelCase, with boolean prefixes is/has/should (per user memory: e.g. isMerged). No alias re-exports that hide the boundary. Existing repo conventions are preserved: ESM, TypeScript strict, oxlint type-aware, ast-grep structural rules, agnix for agents, fallow for dead code, cspell for spell, markdownlint for docs, Stryker for mutation testing scoped to new code at Phase 6. Existing directory naming (src/engine/{flows,atoms,composites,adapters}/) and the *.exec.ts → *.atom.ts rename pattern are followed. Engine ownership is one Engine per command invocation, built via make_ridgeline_engine(cfg), disposed in a finally at the command entry point. The npm run check pipeline (types, lint, struct, agents, dead code, docs, spell, tests) must be green at every phase exit. Do not skip hooks (--no-verify) or bypass signing. CLAUDE.md design philosophy applies: optimize the happy path, keep modules composable with full interfaces, expose the full capability set rather than minimal slices, fold universal features into defaults.

## Runtime

- **Dev server port:** 3000
