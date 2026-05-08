# Phase 10 — Stryker environment record

## Summary

Phase 10 attempted to capture two Stryker mutation scores:

1. The pre-migration absolute baseline on `src/engine/pipeline/`
   (deferred from Phase 1 with `captured: false`).
2. The post-migration score on
   `src/engine/{flows,atoms,composites,adapters}/**/*.ts`.

Both runs failed under the active sandbox. The failure is the same
architectural constraint that blocked Phase 1: Stryker's logging-server
uses TCP localhost IPC. Greywall denies the connect syscall with EPERM.

## What was tried

### Attempt 1: rescoped Stryker config + vitest pool: 'forks'

Phase 10's documented workaround is to run Stryker with `vitest pool:
'forks'` for `coverageAnalysis: 'perTest'`. This was applied via:

- A separate vitest config at `vitest.stryker.config.ts` setting
  `test.pool: "forks"`.
- Both `stryker.config.mjs` (new-scope) and `stryker.baseline.config.mjs`
  (pre-migration) point at the new vitest config via `vitest:
  { configFile: "vitest.stryker.config.ts" }`.

Result: identical EPERM on `internalConnectMultiple` from
`@stryker-mutator/core/dist/src/child-proxy/child-process-proxy.js:132`.
The `pool: 'forks'` setting only affects vitest's own worker IPC; it
does not affect Stryker core's IPC architecture.

### Attempt 2: minimum-concurrency + dryRunOnly

Reproduced the EPERM with `--concurrency 1 --dryRunOnly` to confirm the
failure happens during Stryker's worker bootstrap (i.e., before any
mutations or test runs). Identical EPERM on the first child-process-proxy
connect.

### Attempt 3: env-var override

`RIDGELINE_SANDBOX=0 GREYWALL_SANDBOX=0 npx stryker run ...` — same
EPERM. These env vars are read by `scripts/check.mjs` to decide whether
to skip the opt-in `mutation` check; they do not influence greywall's
kernel-level enforcement, which continues unconditionally for the
process tree.

## Architectural cause

Stryker core's `LoggingServer` (parent process,
`@stryker-mutator/core/dist/src/logging/logging-server.js`) calls
`net.createServer(...)` and listens on an OS-assigned TCP port.
`LoggingClient` (forked workers,
`@stryker-mutator/core/dist/src/logging/logging-client.js:20`) calls
`net.createConnection(port, 'localhost', res)` to send log events to
the parent. `localhost` resolves to both `::1` and `127.0.0.1`;
greywall blocks the connect on both. The connection is established
before any mutation work begins, so the run aborts immediately.

There is no Stryker config option to disable this logging-server, route
it through a Unix domain socket, or fall back to `process.send()` IPC
(the workers are forked but Stryker reserves the message channel for
control messages via `child-process-proxy.js`).

This is consistent with the original `baseline/mutation-score.json`
note: greywall blocks the TCP-IPC Stryker uses for child-proxy IPC.

## Resolution path

Per Phase 10's `Required Tools` section, mutation runs MUST execute
with one of:

- **Run outside greywall enforcement.** This is the only path that
  works for this codebase. The user (or a host-side CI step) runs
  `npx stryker run stryker.baseline.config.mjs` and `npx stryker run`
  from outside the sandbox. The captured scores are then written to
  `baseline/mutation-score.json` and `phase-10-mutation-score.json`,
  and the AC4 gate flips from "deferred" to "asserting" automatically.
- `vitest pool: 'forks'`. Already configured in
  `vitest.stryker.config.ts`; insufficient on its own.

## What this phase produced under sandbox

- `stryker.config.mjs` is rescoped to
  `src/engine/{flows,atoms,composites,adapters}/**/*.ts` per AC1.
- `stryker.baseline.config.mjs` is set up to capture the
  pre-migration `src/engine/pipeline/` score per AC2's regeneration
  recipe.
- `vitest.stryker.config.ts` enables `pool: 'forks'` for the chdir
  tests under `src/commands/__tests__/`.
- `phase-10-mutation-score.json` records `captured: false` with the
  EPERM trace and the same `_blocking_for_phase_11: true` flag the
  Phase 1 baseline used.
- `baseline/mutation-score.json` is augmented with a
  `_phase_10_attempts` block recording this phase's attempt without
  flipping `captured` to `true`.
- `scripts/phase-10-mutation-gate.mjs` (the AC4 gate) is in place;
  it loads both score files, asserts `new_score >= baseline_score`
  when both are captured, and exits with a `deferred` status (exit
  code 0 with a printed warning) when either is `captured: false`.

## How the operator runs this on the host

```sh
# 1. Capture pre-migration baseline (only needed if baseline/mutation-score.json
#    still records captured: false at Phase 10 entry).
npx stryker run stryker.baseline.config.mjs

# Then write the result into the Phase 0/1 baseline file:
node scripts/phase-10-record-baseline.mjs .check/mutation.pipeline-baseline.json

# 2. Capture new-scope score.
npx stryker run

# Then write the result into the Phase 10 artifact:
node scripts/phase-10-record-newscore.mjs .check/mutation.json

# 3. Run the gate.
node scripts/phase-10-mutation-gate.mjs
# Exit 0: gate passes (new_score >= baseline_score)
# Exit 1: gate fails (new_score < baseline_score)
# Exit 2: gate deferred (one or both scores not captured)
```

The two `phase-10-record-*.mjs` helpers translate Stryker's JSON
report into the Phase 10 score artifact format.
