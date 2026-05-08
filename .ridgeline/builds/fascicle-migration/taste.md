<!-- role: data -->
# Taste

## Code Style

- ESM only; no CommonJS shims. TypeScript strict; no `any` without an inline justification comment.
- Booleans use `is`/`has`/`should` prefixes (e.g., `isMerged`, `hasCheckpoint`, `shouldRetry`) — enforced by ast-grep where practical.
- Fascicle imports stay snake_case as exported (`create_engine`, `model_call`, `run`, `retry`, `aborted_error`); no alias re-exports rename them to camelCase.
- Ridgeline-side identifiers stay camelCase. The snake_case/camelCase boundary is intentionally visible at call sites — readers can tell at a glance which side of the substrate they're on.
- One Engine per command invocation, constructed via `makeRidgelineEngine`, disposed in a `finally` block at the command entry point. No command path constructs an Engine directly.
- Step factories decorate every Step with `describe('<name>')` so trajectory events carry stable, human-readable names.
- Optimize the happy path while staying as flexible as possible at module boundaries (per repo CLAUDE.md). Expose the full capability set on composites (stop/pause/resume/cleanup) — not just the slice the current call site needs.
- Fold universal features into defaults rather than flags or commands. Fascicle's `install_signal_handlers: true` default replaces ridgeline's manual SIGINT handler; `ctx.on_cleanup` replaces ad hoc teardown registries.
- Use the simplest fascicle primitive that fits at the boundary while preserving fascicle's full primitive surface internally. Only introduce a Tier 2 composite if Phase 4's audit shows 3+ call-site repetitions of the same imperative pattern; otherwise leave it imperative.
- Pick `phase`'s `archive_feedback` slot OR `adversarial_archived` as a Tier 2 decorator — not both.
- Ridgeline-specific composites (`graph_drain`, `cost_capped`) stay ridgeline-side until exercised in production; tag them in code as upstream-RFC candidates pending production exposure, but do not push them upstream in this migration.
- Prefer `instanceof` checks against fascicle's typed errors over regex pattern matching for classification. Auth and schema-validation errors abort; rate limits and 5xx retry; aborted_error short-circuits all retry layers.
- No backwards-compat shims, deprecated re-exports, or `// removed` marker comments — delete cleanly at Phase 7. If a symbol is unused after migration, delete it; do not rename to `_unused` or leave a stub.
- No `--no-verify`, no skipping hooks, no bypassing signing.
- Preserve prompt-cache hit rate by routing every `model_call` through `stable.prompt.ts` as the `ModelCallInput` shaper. If any atom skips it, prompt-cache hit rate degrades silently and costs balloon without a visible signal — this is enforced by ast-grep.

## Visual Style

The migration has no UI surface, but several output-medium preferences guide new code in `src/engine/{flows,atoms,composites,adapters}/`.

- Prefer routing new diagnostic events through `ctx.trajectory.emit(...)` over direct `console.error`/`console.log` or `process.stderr/stdout.write`. The terminal stays quiet; trajectory.jsonl carries substrate detail.
- Lean toward terse, single-line status messages for any new user-facing output that does need stderr/stdout — never multi-line preambles or banners.
- Prefer `tee_logger` composition when a second sink (e.g., the ridgeline UI or fascicle-viewer) needs the same event stream. The existing `.jsonl` path stays authoritative.
- Lean toward fixture-driven snapshot tests for byte-fidelity assertions — golden files under `.ridgeline/builds/fascicle-migration/baseline/fixtures/` are the regression net for terminal output, on-disk artifacts, and error shapes.
- No emoji in any source file or terminal output. No new ANSI escape sequences or terminal styling primitives in new code.
- New ridgeline-emitted trajectory event types use camelCase; fascicle-emitted event types retain snake_case as fascicle emits them. Names are stable, descriptive, and lowercase-first.
- Updated docs match the existing tone, heading hierarchy (h1 page title, h2 sections, h3 subsections), and code-fence language tags. No new admonitions, banners, or callout styles. No Mermaid diagrams or images added if they are not already present in the docs/ tree.

## Test Patterns

- Vitest 4.1.2 for unit and integration tests under `src/engine/{atoms,composites,flows,adapters}/__tests__/<name>.test.ts`.
- Stub Engine pattern for atom tests: a fake `Engine.generate` returning a fixed `GenerateResult` is the default; do not call the real `claude_cli` provider in unit tests. Pass `skip_probe: true` so fixtures never make network probes.
- Existing E2E fixtures under `vitest.e2e.config.ts` remain the primary regression net for the twelve §7 invariants.
- Fixture-replay tests load pre-migration recordings (`.jsonl`, `.json`, `.md`) and assert byte equality of the new code path's output. No per-event tolerance unless a numeric field requires it (1e-9 USD for budget totals is the documented default).
- Each Tier 1 composite has ≥ 4 unit tests: abort propagation, trajectory event emission, `ctx.on_cleanup` registration firing on success/failure/abort, error surfacing.
- Each atom has ≥ 1 unit test using a stub Engine.
- ast-grep rules enforce structural invariants:
  - every `commands/*.ts` that imports `run` also calls `dispose()` in a finally block
  - no atom imports from `src/engine/pipeline/` or from deleted `claude/{claude.exec,stream.*}` modules
  - fascicle `create_engine` is imported only by `src/engine/engine.factory.ts`
  - no `console.*` or `process.stderr/stdout.write` in `src/engine/{flows,atoms,composites,adapters}/`
  - no emoji literals or new ANSI escape sequences in new directories
  - no `export ... as <camelCaseName>` re-export of fascicle-snake_case symbols
- Snapshot tests for `ridgeline --help` and per-subcommand `--help` lock byte equality against `baseline/help/`. Snapshot tests for `tsc --emitDeclarationOnly` output lock byte equality against `baseline/dts/`.
- Stryker mutation testing scoped to `src/engine/{flows,atoms,composites,adapters}/**/*.ts` at Phase 7; mutation score must be ≥ the Phase 0 baseline recorded for `src/engine/pipeline/` (captured at Phase 7 outside the sandbox if Phase 0's run was blocked, e.g., greywall TCP-IPC EPERM).
- Greywall integration tests pass at Phase 2 exit with zero modifications to the tests themselves — if a test needs adjusting, that's a red flag to investigate the policy builder, not the test.
- Worktree merge-order regression test deliberately stalls higher-index phases to prove `worktree_isolated` merges in `index_order`, not `completion_order`.
- SIGINT regression test confirms exit code 130 is preserved after fascicle's `install_signal_handlers` default takes over, and that worktrees plus claude subprocesses are torn down (no orphans visible in `ps`).

## Commit Format

- Phase exit commits are produced by the ridgeline builder loop, which owns commit naming. No specific subject prefix is required; the `phase-<N>-check.json` artifact is the phase-exit signal.
- Intermediate commits within a phase follow Conventional Commits matching repo history: `feat(scope):`, `fix(scope):`, `chore(scope):`, `docs:`, `refactor(engine):`. Reference `fascicle-migration` in the body for traceability when useful.
- One phase per PR (or one phase split into ≤ 3 PRs if > 800 LOC). Every PR ends with `npm run check` green and `ridgeline build` operational.
- PR descriptions for migration work list the old → new test mapping (when tests are rewritten at a higher abstraction level) and the plugin-surface audit results (when applicable).
- Co-authored-by Claude trailer is permitted; commits never use `--no-verify` or bypass signing.

## Comment Style

- Default to no comments. When required, prefer a single-line WHY comment over multi-line WHAT.
- Each adapter file has a top-of-file comment recording the cross-system decision it embodies. Specifically, `ridgeline_trajectory_logger.ts` records: `Translates fascicle TrajectoryEvent → ridgeline on-disk event shape (decision: translate, not verbatim — preserves fascicle-viewer and external .jsonl consumer back-compat).`
- Tier 2 composite candidates and graph_drain/cost_capped upstream candidacy are tagged in code with a brief deferral-rationale comment.
- Per-feature/per-task comments tied to PR numbers or issue IDs are forbidden — that context belongs in the PR description and the CHANGELOG. Don't write `// added for the fascicle migration` or `// see issue #42`.
- Never explain WHAT the code does (well-named identifiers cover that). Only explain WHY when the WHY is non-obvious — a hidden invariant, a §7 invariant being preserved, a workaround for a fascicle quirk, or behavior that would surprise a reader.
- Multi-paragraph docstrings are forbidden. One short line per comment is the ceiling.
