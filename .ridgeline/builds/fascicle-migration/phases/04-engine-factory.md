---
depends_on: [02-sandbox-policy]
---

# Phase 4: Engine factory

## Goal

Introduce the single canonical Engine constructor at
`src/engine/engine.factory.ts`, exporting `makeRidgelineEngine(cfg): Engine`.
This factory is the only file in the codebase that imports fascicle's
`create_engine` — every command path constructs its Engine through this
factory. The factory composes the sandbox policy from Phase 2, configures
the `claude_cli` provider for `auth_mode: 'auto'` (preserving
subscription/OAuth — no `ANTHROPIC_API_KEY` required), threads `plugin_dirs`
and `setting_sources` through ridgeline's existing
`discoverPluginDirs` / `cleanupPluginDirs` lifecycle, maps
`--timeout <minutes>` to `startup_timeout_ms` (constant 120_000) and
`stall_timeout_ms` (`timeoutMinutes * 60_000` or 300_000 by default), and
sets `skip_probe: process.env.VITEST === 'true'` so unit tests don't make
network probes.

By phase exit an ast-grep rule prevents any file other than
`engine.factory.ts` from importing `create_engine`, and unit tests assert
each cfg-to-fascicle mapping behaves correctly. No command path consumes
the factory yet — Phases 8 and 9 wire it in.

## Context

This phase depends on Phase 2 (sandbox policy) because the factory's
greywall sandbox config is built by `buildSandboxPolicy(...)` from
`src/engine/claude/sandbox.policy.ts`. Without that import, criterion 5 of
this phase (asserting `providers.claude_cli.sandbox.kind === 'greywall'` for
`'semi-locked'` and `'strict'`) cannot be satisfied. The reviewer's earlier
sequencing concern is resolved by ordering: Phase 2 runs first, the factory
imports the policy builder directly, and no stopgap is required.

Phase 3 (adapters) lands separately because adapters are passed into
`run(flow, input, opts)` per command invocation, not into `create_engine`.
The factory and the adapters meet later, in command entry points (Phase 8).

## Acceptance Criteria

1. `src/engine/engine.factory.ts` exists and exports
   `makeRidgelineEngine(cfg: { sandboxFlag: 'off' | 'semi-locked' | 'strict', timeoutMinutes?: number, pluginDirs: string[], settingSources: string[], buildPath: string, networkAllowlistOverrides?: string[], additionalWritePaths?: string[] }): Engine`.
   The signature uses camelCase ridgeline-side identifiers; the boolean-naming
   convention does not apply (no booleans in this signature).
2. An ast-grep rule asserts that fascicle's `create_engine` is imported
   only by `src/engine/engine.factory.ts`. Any other file containing
   `import ... create_engine` (or `import { ..., create_engine, ... }`,
   namespace import, or aliased import) fails `npm run check`.
3. A unit test using a mocked `create_engine` asserts the call receives
   `providers.claude_cli.auth_mode === 'auto'` regardless of cfg input —
   subscription/OAuth is the canonical path; no `ANTHROPIC_API_KEY` is
   required at any point.
4. A unit test asserts `providers.claude_cli.sandbox` is `undefined` (or
   `{ kind: 'none' }`, whichever fascicle 0.3.x's documented
   "sandbox-disabled" representation is at the pinned version) when
   `cfg.sandboxFlag === 'off'`.
5. A unit test asserts `providers.claude_cli.sandbox.kind === 'greywall'`
   for both `cfg.sandboxFlag === 'semi-locked'` and
   `cfg.sandboxFlag === 'strict'`. The factory consumes
   `buildSandboxPolicy(...)` from `src/engine/claude/sandbox.policy.ts`
   for this — no inline fallback.
6. A unit test asserts `providers.claude_cli.startup_timeout_ms === 120000`
   regardless of cfg input.
7. A unit test asserts `providers.claude_cli.stall_timeout_ms === timeoutMinutes * 60_000`
   when `cfg.timeoutMinutes` is provided, and `=== 300000` when
   `cfg.timeoutMinutes` is omitted. The two-timeout mapping rule from
   `--timeout <minutes>` to two separate fascicle timeouts is documented
   in a single-line top-of-file comment.
8. A unit test asserts `providers.claude_cli.skip_probe === true` when
   `process.env.VITEST === 'true'` and `=== false` otherwise.
9. A unit test asserts `providers.claude_cli.plugin_dirs` is the array
   passed in via `cfg.pluginDirs` and `providers.claude_cli.setting_sources`
   is `cfg.settingSources`, both passed through verbatim (no filtering, no
   deduplication beyond what fascicle does internally).
10. An integration test using spies asserts the lifecycle:
    `discoverPluginDirs` is called exactly once per `makeRidgelineEngine`
    invocation, BEFORE `create_engine`; `cleanupPluginDirs` is called
    exactly once, AFTER `engine.dispose()`. The order is observed via spy
    invocation timestamps or call ordering.
11. The factory function is named `makeRidgelineEngine` (camelCase,
    ridgeline-side) — not `make_ridgeline_engine` and not
    `createRidgelineEngine`.
12. `npm run check` exits with zero status.
13. `ridgeline build` runs end-to-end on the old pipeline (the factory is
    not yet consumed by any command path).
14. `.ridgeline/builds/fascicle-migration/phase-4-check.json` exists and is
    a verbatim copy of `.check/summary.json` at this phase's exit commit.

## Spec Reference

From `spec.md`, "Engine factory and per-command lifecycle":
> A single canonical Engine constructor at src/engine/engine.factory.ts.
> Exactly one Engine per command invocation, disposed in a finally block.
> No command path constructs an Engine directly; only via the factory.

From `constraints.md`, "Framework and Core Dependencies":
> claude_cli provider (built into fascicle) — owns Claude subprocess spawn,
> greywall/bwrap sandbox kinds, auth modes (`auto | oauth | api_key`),
> `plugin_dirs`, `setting_sources`, `default_cwd`, `startup_timeout_ms`,
> `stall_timeout_ms`, `skip_probe`. Defaults: `auth_mode: 'auto'`,
> `startup_timeout_ms: 120_000`, `stall_timeout_ms: 300_000` (or
> `timeoutMinutes * 60_000` when `--timeout` is set).
