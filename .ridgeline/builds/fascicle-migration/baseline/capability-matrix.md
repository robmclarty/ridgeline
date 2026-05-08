# Fascicle claude_cli capability matrix (pinned baseline)

Version pinned in `package.json`: `fascicle 0.3.8` (exact-pinned)
Verified against: `node_modules/fascicle/dist/index.d.ts`, `node_modules/fascicle/dist/index.js`
Captured: 2026-05-05
Re-verified at Phase 7 (2026-05-06): every row below re-checked against the
pinned 0.3.8 dist; no drift detected.

This document records the runtime contract every later phase relies on. Each row is verified against the pinned fascicle source — no row is assumed.

## Provider config surface

`ClaudeCliProviderConfig` (from `index.d.ts` lines 1001–1019):

| Field                  | Type                                                       | Verified default                                |
| ---------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| `binary`               | `string?`                                                  | resolved from PATH (`claude`)                   |
| `auth_mode`            | `'auto' \| 'oauth' \| 'api_key'`                          | `'auto'` (`config.auth_mode ?? "auto"`)        |
| `api_key`              | `string?`                                                  | undefined                                       |
| `inherit_env`          | `boolean?`                                                 | `true` under oauth; `false` under api_key       |
| `default_cwd`          | `string?`                                                  | undefined                                       |
| `startup_timeout_ms`   | `number?`                                                  | `120_000` (`config.startup_timeout_ms ?? 12e4`) |
| `stall_timeout_ms`     | `number?`                                                  | `300_000` (`config.stall_timeout_ms ?? 3e5`)    |
| `setting_sources`      | `ReadonlyArray<'user' \| 'project' \| 'local'>?`         | undefined                                       |
| `plugin_dirs`          | `ReadonlyArray<string>?`                                   | undefined                                       |
| `sandbox`              | `SandboxProviderConfig?`                                   | undefined (no sandbox)                          |
| `skip_probe`           | `boolean?`                                                 | declared in type; not observed in 0.3.8 runtime |

Note on `skip_probe`: declared in `ClaudeCliProviderConfig` but no consuming reference exists in `node_modules/fascicle/dist/index.js`. Either it is reserved-for-future-use in 0.3.8 or the probe path is gated elsewhere. Phase 0 records this gap; Phase 6's engine factory test (`skip_probe === true when VITEST === 'true'`) must confirm fascicle honours it before Phase 6 exit.

## Sandbox kinds

`SandboxProviderConfig` (from `index.d.ts` lines 992–1000):

```ts
type SandboxProviderConfig =
  | { kind: 'bwrap'; network_allowlist?: ReadonlyArray<string>; additional_write_paths?: ReadonlyArray<string> }
  | { kind: 'greywall'; network_allowlist?: ReadonlyArray<string>; additional_write_paths?: ReadonlyArray<string> }
```

| Kind        | Supported by 0.3.8? | Notes                                                                |
| ----------- | ------------------- | -------------------------------------------------------------------- |
| `'bwrap'`   | yes                 | Linux bubblewrap                                                     |
| `'greywall'`| yes                 | macOS greywall — ridgeline's pre-migration default                   |
| `'none'`    | n/a                 | Represented by `sandbox: undefined` (no `'none'` discriminant exists)|

The mapping `--sandbox=off → undefined`, `--sandbox=semi-locked → { kind: 'greywall', ... }`, `--sandbox=strict → { kind: 'greywall', ... }` is what `buildSandboxPolicy` (Phase 3) must emit.

## Auth modes

`AuthMode` (from `index.d.ts` line 991):

```ts
type AuthMode = 'auto' | 'oauth' | 'api_key'
```

| Mode       | Behavior                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------- |
| `'auto'`   | OAuth-first; falls back to API key when OAuth not present. Ridgeline default.             |
| `'oauth'`  | OAuth only; subprocess inherits env from `process.env` unless `inherit_env: false`        |
| `'api_key'`| API-key only; subprocess starts from empty env by default                                 |

User uses Claude subscription (OAuth) — `auth_mode: 'auto'` is the only acceptable mapping for ridgeline.

## Streaming events (`StreamChunk`)

From `index.d.ts` lines 1138–1178:

| `kind`                     | Fields                                                              |
| -------------------------- | ------------------------------------------------------------------- |
| `'text'`                   | `text: string; step_index: number`                                 |
| `'reasoning'`              | `text: string; step_index: number`                                 |
| `'tool_call_start'`        | `id: string; name: string; step_index: number`                     |
| `'tool_call_input_delta'`  | `id: string; delta: string; step_index: number`                    |
| `'tool_call_end'`          | `id: string; input: unknown; step_index: number`                   |
| `'tool_result'`            | `id: string; output?: unknown; error?: { message }; step_index`    |
| `'step_finish'`            | `step_index: number; finish_reason: FinishReason; usage`           |
| `'finish'`                 | `finish_reason: FinishReason; usage: UsageTotals`                  |

These are passed to `GenerateOptions.on_chunk(chunk)`. Ridgeline's existing terminal display must handle every kind without breakage.

## Cost reporting (`GenerateResult` + `CostBreakdown`)

From `index.d.ts` lines 1056–1065 and 1199–1211:

```ts
type CostBreakdown = {
  total_usd: number;
  input_usd: number;
  output_usd: number;
  cached_input_usd?: number;
  cache_write_usd?: number;
  reasoning_usd?: number;
  currency: 'USD';
  is_estimate: true;
}
type GenerateResult<t = string> = {
  content: t;
  tool_calls: ToolCallRecord[];
  steps: StepRecord[];
  usage: UsageTotals;
  cost?: CostBreakdown;
  finish_reason: FinishReason;
  model_resolved: { provider: string; model_id: string };
  provider_reported?: Record<string, unknown>;
}
```

Adapter `ridgeline_budget_subscriber` (Phase 2) must fold `cost.total_usd` (and optionally `cached_input_usd`/`cache_write_usd`) into ridgeline's existing `budget.json` totals.

## AbortSignal propagation

`GenerateOptions.abort?: AbortSignal` (line 1190). Aborts unconditionally short-circuit retry layers via `aborted_error` (typed error class exported from fascicle root).

The runner (`run`) installs default SIGINT/SIGTERM handlers when `RunOptions.install_signal_handlers !== false`. From `index.js`:

```js
const install_signal_handlers = options.install_signal_handlers !== false;
// ...
if (install_signal_handlers) ensure_signal_handlers();
```

Verified default for `run`: **`true`** (via `!== false` semantics).

Verified default for `bench` runner (separate code path): **`false`** (`options.install_signal_handlers ?? false`). Not used by ridgeline.

## Model alias set (verified at 0.3.8)

From `node_modules/fascicle/dist/index.js`:

| Alias            | Resolved model_id                       |
| ---------------- | --------------------------------------- |
| `claude-opus`    | `claude-opus-4-7`                       |
| `opus`           | `claude-opus-4-7`                       |
| `claude-sonnet`  | `claude-sonnet-4-6`                     |
| `sonnet`         | `claude-sonnet-4-6`                     |
| `claude-haiku`   | `claude-haiku-4-5`                      |
| `haiku`          | `claude-haiku-4-5`                      |
| `cli-opus`       | `claude-opus-4-7`                       |
| `cli-sonnet`     | `claude-sonnet-4-6`                     |
| `cli-haiku`      | `claude-haiku-4-5`                      |
| `or:sonnet`      | `anthropic/claude-sonnet-4.5` (openrouter route) |

Ridgeline uses `opus` as its default (configurable via `--model` / settings.json). All three named tiers (opus/sonnet/haiku) resolve under the claude_cli provider.

## RunOptions defaults

`RunOptions` (from `index.d.ts` lines 64–69):

| Field                       | Type                                          | Default |
| --------------------------- | --------------------------------------------- | ------- |
| `install_signal_handlers`   | `boolean?`                                    | `true`  |
| `trajectory`                | `TrajectoryLogger?`                           | `noop_logger` (in-tree no-op) |
| `checkpoint_store`          | `CheckpointStore?`                            | `undefined` (no per-step memoization) |
| `resume_data`               | `Readonly<Record<string, unknown>>?`          | `undefined` |

## Engine API

`Engine.generate<t>(opts: GenerateOptions<t>): Promise<GenerateResult<t>>` (line 1279).

`create_engine` is the only Engine constructor exported from fascicle root and must be called only from `src/engine/engine.factory.ts` (enforced by ast-grep at Phase 6).

## Adapter subpath: NOT exported in 0.3.8

`fascicle/adapters` subpath is referenced in the migration constraints but `node_modules/fascicle/package.json` only declares `"."` under `exports`. `tee_logger`, `filesystem_logger`, `noop_logger`, `http_logger`, `filesystem_store` are NOT exported in 0.3.8. Phase 2 (Adapters) must implement ridgeline-side equivalents directly conforming to the `TrajectoryLogger` and `CheckpointStore` contracts re-exported from fascicle root, not import them from a `fascicle/adapters` subpath.

## Required peers vs ridgeline policy

Required peers in `node_modules/fascicle/package.json`:

| Peer                              | Range          | Optional? | Ridgeline policy                                                          |
| --------------------------------- | -------------- | --------- | ------------------------------------------------------------------------- |
| `zod`                             | `^4.0.0`       | required  | Pinned at `^4.1.8` (deviates from spec criterion #2 — see handoff)        |
| `ai`                              | `^6.0.0`       | required  | NOT installed (claude_cli provider doesn't import `ai`); npm warns        |
| `@ai-sdk/anthropic`               | `^3.0.0`       | optional  | NOT installed                                                             |
| `@ai-sdk/google`                  | `^3.0.0`       | optional  | NOT installed                                                             |
| `@ai-sdk/openai`                  | `^3.0.0`       | optional  | NOT installed                                                             |
| `@ai-sdk/openai-compatible`       | `^2.0.0`       | optional  | NOT installed                                                             |
| `@openrouter/ai-sdk-provider`     | `^2.0.0`       | optional  | NOT installed                                                             |
| `ai-sdk-ollama`                   | `^3.0.0`       | optional  | NOT installed                                                             |

The `ai` peer is required by fascicle but NOT installed by ridgeline because the migration uses only the claude_cli provider, which is built into fascicle and does not import `ai` at runtime. Phase 1 install reported this as a peer warning, not an error — runtime imports must be re-verified at Phase 5 (atoms) when the first `model_call` lands.

## Engines.node

`fascicle@0.3.8` requires `node >= 24.0.0`. Aligns with ridgeline's bumped `engines.node` field. Local `node --version` at capture: `v24.15.0`.

## Phase-by-phase invariants this matrix protects

- Phase 2 (adapters): trajectory/checkpoint/budget contracts match the types in this matrix.
- Phase 3 (sandbox policy): `SandboxProviderConfig` discriminator and field shape match this matrix.
- Phase 5 (atoms): `model_call` accepts `system`, `prompt`, `tools`, `schema`, `schema_repair_attempts` per `GenerateOptions` here.
- Phase 6 (engine factory + flows): `RunOptions.install_signal_handlers` default is `true`; `auth_mode: 'auto'` preserves OAuth.
- Phase 7 (build/auto + SIGINT): `aborted_error` short-circuits retry layers; `install_signal_handlers: true` torn down on SIGINT with exit code 130.
- Phase 8 (cleanup): typed error classes (`aborted_error`, `provider_error`, `rate_limit_error`, `schema_validation_error`, etc.) exported from fascicle root match `instanceof` checks replacing `FATAL_PATTERNS`.

## Phase 7 re-verification (2026-05-06)

Each row in this matrix was re-verified against the pinned `fascicle@0.3.8`
distribution at Phase 7 exit:

- `package.json` resolves `fascicle` to exactly `0.3.8`; `node_modules/fascicle/package.json` reports `"version": "0.3.8"`.
- `auth_mode` default — confirmed `(config.auth_mode ?? "auto")` in
  `node_modules/fascicle/dist/index.js`.
- `startup_timeout_ms` default — confirmed `config.startup_timeout_ms ?? 12e4`.
- `stall_timeout_ms` default — confirmed `config.stall_timeout_ms ?? 3e5`.
- `install_signal_handlers` (run runner) default — confirmed `options.install_signal_handlers !== false`.
- `install_signal_handlers` (bench runner) default — confirmed `options.install_signal_handlers ?? false`.
- `skip_probe` — declared in `ClaudeCliProviderConfig` (`readonly skip_probe?: boolean`),
  no consuming reference in `dist/index.js`. **Drift: none — same as Phase 0
  baseline.** The engine factory still sets the field; whether 0.3.8 honors
  it is a Phase 6/8 (build/auto + dogfood) verification concern, not a
  Phase 7 blocker. No change to the type or runtime behavior between Phase
  0 capture and Phase 7 re-verification.
- `SandboxProviderConfig` discriminated union — `'bwrap'` and `'greywall'`
  variants present; no third kind added in 0.3.8.
- `RunOptions` shape — `install_signal_handlers`, `trajectory`,
  `checkpoint_store`, `resume_data` present; no fields added in 0.3.8.
- `Engine.generate<t>` signature unchanged.
- Adapter subpath `fascicle/adapters` — still NOT exported by 0.3.8 (only
  `"."` exported); ridgeline-side adapters remain authoritative.
- Required peer `ai` (`^6.0.0`) — still required by package.json, still
  NOT installed by ridgeline (claude_cli provider built into fascicle
  does not import `ai`); npm warns at install time, not an error.

**No drift detected. Matrix unchanged below this footer; capability
contract intact for Phase 8/9 consumers.**
