# Exit codes — pre-migration ridgeline baseline

Captured at commit on the `fascicle` branch. Verified against `src/cli.ts`, `src/commands/*.ts`, and `src/utils/*.ts`.

## Codes

| Code | Trigger                                                                                       | Source                                       |
| ---- | --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `0`  | Successful completion of any command                                                          | implicit (process ends naturally)            |
| `0`  | `ridgeline check` after detection report prints                                               | `src/cli.ts:605`                             |
| `1`  | Generic command failure surfaced by `handleCommandError(err)`                                 | `src/cli.ts:93–96`                           |
| `1`  | `requireBuildName` resolves to empty (build name required but missing)                        | `src/cli.ts:84–90`                           |
| `1`  | `uncaughtException` handler                                                                   | `src/cli.ts:62–66`                           |
| `1`  | `unhandledRejection` handler                                                                  | `src/cli.ts:68–75`                           |
| `1`  | Default-action error path (e.g., bad arguments to the orchestrator)                           | `src/cli.ts:280, 404`                        |
| `1`  | `runPreflightGuard` aborts on sandbox tool-probe failures                                     | `src/cli.ts:148–151`                         |
| `1`  | `runBuild` finishes with `failed > 0` after summary table prints                              | `src/commands/build.ts:381–384`              |
| `1`  | `flavour-removed` deprecation surface                                                         | `src/utils/flavour-removed.ts:36`            |
| `130`| SIGINT — Ctrl+C handler kills Claude subprocesses, then `setTimeout(...exit(130), 2500)`     | `src/cli.ts:56–59`                           |

Note: ridgeline does NOT emit dedicated exit codes for auth failure, schema-validation failure, or budget-exceeded — all three currently flow through the generic `1` exit code via `handleCommandError`. The migration must preserve this; the underlying cause is surfaced in stderr text and trajectory events, not in distinct exit codes.

## SIGINT teardown sequence (pre-migration)

1. SIGINT received.
2. `killAllClaude()` (async-best-effort) signals every spawned Claude subprocess.
3. A 2.5-second timer fires `process.exit(130)`.
4. `process.on('exit')` handler calls `killAllClaudeSync()` to belt-and-suspenders any lingering subprocesses.

The migration's Phase 7 must reproduce this contract via fascicle's `install_signal_handlers: true` default plus `ctx.on_cleanup` registrations — exit code 130, no orphan subprocesses, no orphan worktrees.

## Phase 7 invariant tied to this file

`SIGINT semantics` (§7 invariant 5) regression test must assert:
- Process exit code === 130 after SIGINT.
- No `claude` subprocesses remain (verified by `ps`).
- No `.worktrees/` directories remain for the killed build.
- No "double cleanup" errors logged (must NOT have both fascicle's handler and a residual ridgeline-side handler firing).
