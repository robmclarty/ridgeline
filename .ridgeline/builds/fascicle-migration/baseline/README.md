# Phase 0 baseline corpus

This directory pins the pre-migration behavior of ridgeline so every later
fascicle-migration phase can assert byte equality, semantic equivalence, or
parity against a known-good reference. Every artifact below is reproducible
from a clean checkout of the pre-migration commit using only the commands
and environment documented here.

## Provenance

- **Repo state**: `fascicle` branch, working tree at the commit immediately
  preceding the phase-0 exit commit (i.e. the pre-phase checkpoint at
  `00de3d0` plus the Phase 0 dependency + scaffolding diff).
- **Capture host**: macOS Darwin 25.3.0; Node `v24.15.0`; Claude Code CLI
  trust path; greywall `semi-locked` enforcement on (network egress filtered
  to the host set in `sandbox-allowlist.semi-locked.json`).
- **Tool versions**: TypeScript `5.9.3`, vitest `4.1.2`, Stryker `9.6.1`,
  oxlint `1.58.0`, ast-grep `0.42.1`, agnix `0.17.0`, fallow `2.13.0`,
  cspell `10.0.0`, markdownlint-cli2 `0.21.0`.
- **Terminal width**: snapshots captured with `COLUMNS=120` and
  `NO_COLOR=1` for reproducibility.

## Artifacts

### `help/<command>.txt`

Byte snapshot of `ridgeline --help` and every documented subcommand's
`--help` output. Captured by:

```bash
COLUMNS=120 NO_COLOR=1 node dist/cli.js --help                  > baseline/help/ridgeline.txt
COLUMNS=120 NO_COLOR=1 node dist/cli.js <subcommand> --help     > baseline/help/<subcommand>.txt
```

The acceptance-criteria minimum list (`auto`, `create`, `input`, `qa-workflow`)
includes names that are NOT first-class commander subcommands. Running
`node dist/cli.js auto --help` falls through to the default command's help
output. Those four files capture that fall-through verbatim — they remain
useful regression nets: if Phase 5 promotes any of them to a real subcommand,
the snapshot will diverge and force an explicit baseline refresh.

### `dts/`

External function signatures of every `src/commands/*.ts` exported function,
captured via `tsc --emitDeclarationOnly` against `tsconfig.json`. Phase 5
asserts byte equality of post-migration `tsc --emitDeclarationOnly` output
against this directory.

```bash
npx tsc --emitDeclarationOnly --outDir baseline/dts
```

### `fixtures/`

Recorded artifacts from a successful pre-migration `ridgeline build` against
a representative build:

- `trajectory.jsonl` — every event type ridgeline emits today, in event order.
- `state.json` — final `BuildState` shape after a successful build.
- `budget.json` — cumulative cost ledger after a successful build.
- `phases/<id>.md` — phase-spec markdown emitted by `ridgeline plan`.
- `error-shapes.json` — `error.name`, `error.message`, and surface text
  (stderr / trajectory event kind) for adversarial round-cap exhaustion,
  schema-validation failure, auth failure, and budget-exceeded paths.
  Pre-migration code uses plain `Error` throws and regex-based
  `FATAL_PATTERNS` classification, not typed error classes — so this file
  records the *user-visible* error shapes (stderr text, trajectory event
  kind). Phase 7 re-snapshots and asserts byte equality.
- `builder-modelcall-input.json` — the resolved
  `system + messages + tools + schema` payload handed to the model invocation
  for a frozen `BuilderArgs` input. Phase 5's prompt-cache-stability test
  asserts the new `pipe(stable.prompt → model_call)` shape produces a
  byte-identical `ModelCallInput`.

### `mutation-score.json`

Stryker mutation testing baseline scoped to `src/engine/pipeline/**/*.ts`.
**Currently captured as a placeholder** — the Stryker run could not complete
under the migration's greywall sandbox because Stryker's worker IPC requires
localhost socket binds blocked by the policy. The file documents:

- The exact `mutate` glob and Stryker config to use.
- The exact failure (`AggregateError EPERM` from Node `v24.15.0`'s
  `internalConnectMultiple`).
- The regeneration command (a heredoc'd Stryker config with sandbox-permitted
  IPC) that must be run outside the greywall sandbox before Phase 7's
  mutation-score gate.

Phase 7 cannot exit until this score is regenerated and the post-migration
score on `src/engine/{flows,atoms,composites,adapters}/**/*.ts` meets or
exceeds it.

### `capability-matrix.md`

Pinned capability matrix for fascicle's `claude_cli` provider at the version
declared in `package.json` (`fascicle ^0.3.8`). Each row was verified against
`node_modules/fascicle/dist/index.d.ts` and `node_modules/fascicle/dist/index.js`,
not assumed from spec text. The file records:

- Provider config surface (every field of `ClaudeCliProviderConfig`).
- Sandbox kinds supported (`bwrap`, `greywall`; `'none'` represented by
  `sandbox: undefined`).
- Auth modes (`auto`, `oauth`, `api_key`).
- Streaming events (every variant of `StreamChunk`).
- Cost reporting fields on `GenerateResult`.
- AbortSignal propagation behavior.
- Model alias set.
- `startup_timeout_ms` default (`120_000`).
- `stall_timeout_ms` default (`300_000`).
- `skip_probe` declared-but-unobserved status (gap to confirm in Phase 6).
- `install_signal_handlers` runner default (`true`, owned by `run(...)`).

### `exit-codes.md`

Enumeration of every exit code emitted by ridgeline today (success, generic
failure, SIGINT 130, auth failure, budget-exceeded, schema-validation
failure) with the trigger condition and code path for each, plus the pre-
migration SIGINT teardown sequence. Phase 7 invariant 5's regression test
must reproduce this contract via fascicle's `install_signal_handlers: true`
default plus `ctx.on_cleanup` registrations.

Captured by reading `src/cli.ts`, `src/commands/*.ts`, and `src/utils/*.ts`
at the pre-phase commit. Verify with:

```bash
grep -REn 'process\.exit\(' src/
grep -REn 'handleCommandError|process\.on\("uncaughtException' src/cli.ts
```

### `greywall-tests.txt`

Enumeration of every greywall-related `describe` / `it` block under
`src/engine/__tests__/` and elsewhere. Phase 3 must keep each one passing
unchanged at phase exit — a forced test adjustment signals a regression in
`sandbox.policy.ts`, not in the test.

Captured by:

```bash
grep -REn '^\s*(test|it|describe)\(["'\''].*' \
  src/engine/claude/__tests__/sandbox.greywall.test.ts \
  src/engine/claude/__tests__/sandbox.test.ts
```

### `sandbox-allowlist.semi-locked.json` and `sandbox-allowlist.strict.json`

Pre-migration network allowlist captured from
`src/stores/settings.ts:DEFAULT_NETWORK_ALLOWLIST + CLAUDE_REQUIRED_DOMAINS`.
Both files share the same host set because pre-migration ridgeline does NOT
vary the network host filter by sandbox mode — mode varies only the greywall
toolchain *profiles* and the additional write paths. The strict file calls
this out explicitly so Phase 3 can decide whether to narrow strict's host
set or leave both modes pointing at the same list.

Phase 3's `buildSandboxPolicy(mode)` must return a `network_allowlist`
whose host set is a subset of (or equal to) the corresponding file. Any
*new* host appearing in a Phase 3 allowlist requires an explicit code-
comment justification in `sandbox.policy.ts`.

## Reproducibility checklist

Any later phase wanting to re-derive these baselines from a fresh checkout
should:

1. Reset to the phase-0 exit commit on the `fascicle` branch.
2. Run `npm ci` to install deps at the pinned versions.
3. Run `npm run build` to refresh `dist/cli.js`.
4. Re-run the per-artifact commands documented above.
5. `git diff baseline/` should be empty (or, when a new artifact type is
   intentionally added, the diff is reviewed and committed alongside the
   updated README).
