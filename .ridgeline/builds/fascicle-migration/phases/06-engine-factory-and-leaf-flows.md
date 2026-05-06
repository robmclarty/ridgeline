# Phase 6: Engine Factory and Leaf Command Flows

## Goal

Land the canonical Engine constructor `makeRidgelineEngine(cfg)` at `src/engine/engine.factory.ts` — the only call site of fascicle's `create_engine` in the codebase, enforced by ast-grep. Then migrate every leaf command (every `src/commands/<name>.ts` that invokes a pipeline executor, except `build` and `auto`) to construct a fascicle flow and call `run(flow, input, opts)` inside a `try { ... } finally { await engine.dispose() }` block at the command entry point.

External command signatures (the function exported from each `commands/<name>.ts` and consumed by `src/cli.ts`) and the CLI flag set are unchanged from the Phase 1 baselines — proven by snapshot tests of `--help` and `tsc --emitDeclarationOnly` output asserting byte equality against `baseline/help/` and `baseline/dts/`.

The engine factory maps ridgeline's `--sandbox` and `--timeout` flags to fascicle's `claude_cli` config, threads `discoverPluginDirs`/`cleanupPluginDirs` through the lifecycle, and selects `auth_mode: 'auto'` to preserve the OAuth/subscription path so `ANTHROPIC_API_KEY` is not required. Bundling the factory with its first batch of consumers in a single phase hardens the factory interface against real usage immediately: 13 leaf commands stress-test the `cfg` shape before `build`/`auto` (Phase 7) lock in their dependencies.

A plugin-surface audit document enumerates every consumer of soon-to-be-deleted exports (`invokeBuilder`, `invokePlanner`, `invokeReviewer`, `runPhase`, `invokeClaude`, `parseStreamLine`, `createStreamHandler`, `extractResult`, `createDisplayCallbacks`) so Phase 8's deletion is targeted and no plugin author is surprised. The `src/cli.ts` manual `process.on('SIGINT', ...)` handler is NOT yet removed in this phase — it covers `build`/`auto` which still use the old surface (defensive overlap during transition).

## Context

Phases 2-5 landed adapters, sandbox policy, Tier 1 composites, and atoms. This phase wires them together for the first time in real commands. The legacy pipeline still runs `build` and `auto`; this phase's commands route through the new substrate.

Tests targeting deleted internals are rewritten at the flow input/output layer in the same PR — the old → new mapping is recorded in the PR description and a copy is preserved at `.ridgeline/builds/fascicle-migration/phase-5-test-rewrites.md`. Coverage is not reduced relative to the Phase 1 baseline.

## Acceptance Criteria

1. `src/engine/engine.factory.ts` exists and exports `makeRidgelineEngine(cfg: { sandboxFlag: 'off' | 'semi-locked' | 'strict', timeoutMinutes?: number, pluginDirs: string[], settingSources: string[], buildPath: string, networkAllowlistOverrides?: string[], additionalWritePaths?: string[] }): Engine`.
2. Ast-grep rule asserts that fascicle's `create_engine` is imported only by `src/engine/engine.factory.ts`. Any other file importing it fails `npm run check`.
3. Engine-factory unit test using a mocked `create_engine` asserts the call receives `providers.claude_cli.auth_mode === 'auto'` (preserving subscription/OAuth, no `ANTHROPIC_API_KEY` required).
4. Engine-factory unit test asserts `providers.claude_cli.sandbox.kind === 'greywall'` for `sandboxFlag` ∈ {`semi-locked`, `strict`}, and `providers.claude_cli.sandbox` is `undefined` (or `{ kind: 'none' }`, matching the pinned fascicle version's documented semantics for the off case) for `sandboxFlag === 'off'`.
5. Engine-factory unit test asserts `startup_timeout_ms === 120_000` in the produced config.
6. Engine-factory unit test asserts `stall_timeout_ms === timeoutMinutes * 60_000` when `timeoutMinutes` is provided, and `=== 300_000` when omitted.
7. The mapping rule from `--timeout <minutes>` to two separate fascicle timeouts (one fixed `startup_timeout_ms`, one `stall_timeout_ms` derived from minutes) is documented in a top-of-file comment in `engine.factory.ts`.
8. Engine-factory unit test asserts `skip_probe === true` when `process.env.VITEST === 'true'` and `false` otherwise.
9. Engine-factory consumes `buildSandboxPolicy(args)` from `src/engine/claude/sandbox.policy.ts` to produce the `claude_cli.sandbox` config — verified by import inspection and unit test using a spy on `buildSandboxPolicy`.
10. Each migrated command's entry point uses `makeRidgelineEngine(cfg)` wrapped in:
    ```ts
    const engine = makeRidgelineEngine(cfg);
    try {
      await run(flow, input, { trajectory, checkpoint_store, install_signal_handlers: true });
    } finally {
      await engine.dispose();
    }
    ```
11. An ast-grep rule flags any `commands/*.ts` that imports fascicle's `run` without a sibling `dispose()` call in the same function; adding such a file fails `npm run check`.
12. Snapshot test of `ridgeline --help` and every subcommand's `--help` output is byte-equal to `.ridgeline/builds/fascicle-migration/baseline/help/<command>.txt`. The snapshot test runs at the same terminal width recorded in `baseline/README.md`.
13. External signatures of every `commands/*.ts` exported function are byte-equal to `.ridgeline/builds/fascicle-migration/baseline/dts/` — verified by re-running `tsc --emitDeclarationOnly` (with the generation command recorded in `baseline/README.md`) and diffing.
14. Commands migrated in this phase: `dry-run`, `research`, `plan`, `retro-refine`, `retrospective`, `qa-workflow`, `directions`, `design`, `shape`, `spec`, `ingest`, `refine`, `rewind`. Each has a corresponding flow file at `src/engine/flows/<command>.flow.ts`.
15. Commands explicitly inspected and confirmed not to invoke pipeline executors are documented in `.ridgeline/builds/fascicle-migration/phase-5-non-migrated-commands.md`: at minimum `catalog`, `check`, `clean`, `create`, `input`, `ui`. Each entry records the reason (e.g., "does not invoke any pipeline executor").
16. Plugin-surface audit document `.ridgeline/builds/fascicle-migration/phase-5-plugin-surface-audit.md` enumerates every plugin call site (and every internal call site outside `src/commands` and `src/engine/pipeline`) that depends on each soon-to-be-deleted symbol: `invokeBuilder`, `invokePlanner`, `invokeReviewer`, `runPhase`, `invokeClaude`, `parseStreamLine`, `createStreamHandler`, `extractResult`, `createDisplayCallbacks`. For each call site: file, line, depended-on symbol, disposition (`updated | removed | n/a`) with a one-line rationale.
17. `pluginDirs` is computed via ridgeline's existing `discoverPluginDirs` exactly once per command invocation and threaded into the engine factory; `cleanupPluginDirs` runs after `engine.dispose()`. An integration test using spies asserts the call order: `discoverPluginDirs` → `makeRidgelineEngine` → `run(flow, ...)` → `engine.dispose()` → `cleanupPluginDirs`.
18. Existing E2E tests for each migrated command pass unchanged.
19. Tests targeting deleted internals are rewritten at the flow input/output layer in the same PR. The old → new mapping is recorded in the PR description and preserved at `.ridgeline/builds/fascicle-migration/phase-5-test-rewrites.md` (one row per rewritten test: old name → new name → abstraction-level note).
20. Coverage is not reduced relative to the Phase 1 baseline; if any line/branch coverage drops, the new tests must close the gap before merge.
21. Ast-grep rule passes: zero `console.*`, zero `process.stdout.write` / `process.stderr.write`, zero emoji literals, zero new ANSI escape sequences in `src/engine/flows/` and in any newly-created files in `src/commands/`.
22. `src/engine/flows/index.ts` re-exports the flow factories using camelCase ridgeline-side names; ast-grep rule passes: no `export ... as <camelCaseName>` re-exports of fascicle-snake_case symbols.
23. An E2E test asserts `engine.dispose()` is called on the success path and the failure path for at least one migrated command.
24. `src/cli.ts` still contains its manual `process.on('SIGINT', ...)` handler at this phase exit (defensive overlap; removed in Phase 7).
25. `npm run check` is green.
26. `ridgeline build` (still on the old pipeline — `build`/`auto` migrate in Phase 7) and every migrated command run end-to-end successfully.
27. `.ridgeline/builds/fascicle-migration/phase-5-check.json` captures a green `.check/summary.json` snapshot at the phase-exit commit.
28. The phase exit commit subject begins with `phase-5:`.

## Spec Reference

- spec.md → "Phase 5 — Leaf command flows": migration list, external command signatures unchanged, plugin-surface audit, manual SIGINT handler retained.
- spec.md → "Engine factory and per-command lifecycle": `makeRidgelineEngine(cfg)` signature, `auth_mode: 'auto'`, sandbox kind mapping, `startup_timeout_ms`/`stall_timeout_ms`/`skip_probe` rules, `discoverPluginDirs` lifecycle, `engine.dispose()` on success/failure/SIGINT.
- spec.md → "Twelve invariants" — invariant 1 (visible behavior unchanged via `--help` byte-equality), invariant 3 (exit code preservation).
- constraints.md → "API Style": command entry-point shape; "Test and Mutation Constraints": snapshot tests for `--help` and `tsc --emitDeclarationOnly`.
- taste.md → "Code Style": one Engine per command invocation, disposed in `finally`; no command path constructs an Engine directly.
