# Bwrap Sandbox for Build Agents

## Problem

Ridgeline's builder agent has `Bash` tool access and can execute arbitrary
commands. Nothing prevents it from writing files outside the repository or
making outbound network requests. Git checkpoints provide recovery for tracked
files, but cannot undo writes to arbitrary filesystem locations or data
exfiltration.

## Solution

Wrap Claude CLI invocations in [bubblewrap](https://github.com/containers/bubblewrap)
(`bwrap`) to enforce kernel-level filesystem and network restrictions during
builds. This is a Linux-only feature — macOS lacks equivalent unprivileged
namespace support.

## CLI interface

Two new flags on the `build` command:

| Flag | Default | Description |
|------|---------|-------------|
| `--sandbox` | off | Enable bwrap sandboxing |
| `--allow-network` | off | Permit outbound network inside sandbox |

- `--sandbox` without `--allow-network` blocks network access by default
  (secure by default).
- `--allow-network` without `--sandbox` is a no-op.
- `--sandbox` requires `bwrap` to be installed. If missing, the harness
  errors immediately with an install hint — no silent fallback.

Only the `build` command gets these flags. `plan`, `dry-run`, and `spec` are
not sandboxed (the planner only has `Write` access scoped to the phases
directory; `spec` is interactive and user-controlled).

## Configuration

Two new fields on `RidgelineConfig`:

```typescript
sandbox: boolean        // default: false
allowNetwork: boolean   // default: false
```

Resolved from CLI opts in `config.ts`. No config file or environment variable
support — these are deliberate per-invocation decisions.

## Sandbox module

New file: `src/engine/claude/sandbox.ts` with three responsibilities.

### Detection

`assertBwrapAvailable()` runs `which bwrap` when `--sandbox` is set. If not
found, throws:

```text
--sandbox requires bubblewrap (bwrap). Install it with your package manager
(e.g., apt install bubblewrap).
```

Called once before the first phase, not per-invocation.

### Argument building

`buildBwrapArgs(repoRoot: string, allowNetwork: boolean): string[]` returns:

```text
bwrap
  --ro-bind / /                      # everything read-only
  --bind <repoRoot> <repoRoot>       # repo writable
  --bind /tmp /tmp                   # tmp writable
  --dev /dev                         # device access
  --proc /proc                       # proc filesystem
  [--unshare-net]                    # unless allowNetwork is true
  --die-with-parent                  # kill sandbox if ridgeline dies
```

`repoRoot` is `process.cwd()` — the directory the user ran `ridgeline build`
from.

### Integration with claude.exec.ts

`invokeClaude` gains two optional fields on `InvokeOptions`:

```typescript
sandbox?: boolean
allowNetwork?: boolean
```

When `sandbox` is true, the spawn call changes from:

```typescript
spawn("claude", args, { cwd, ... })
```

to:

```typescript
spawn("bwrap", [...bwrapArgs, "claude", ...args], { cwd, ... })
```

The rest of `invokeClaude` (timeout handling, output parsing, stdin piping)
is unchanged — `bwrap` is transparent to the child process.

## What gets sandboxed

| Operation | Sandboxed | Reason |
|-----------|-----------|--------|
| Builder (claude) | Yes | Agent-controlled, has Bash |
| Reviewer (claude) | Yes | Has Bash for running checks |
| Planner (claude) | No | Only has Write tool |
| Git operations | No | Harness code, deterministic, needs `.git/` write |
| Spec wizard | No | Interactive, user-controlled |

## Writable directories

| Path | Purpose |
|------|---------|
| `<repoRoot>` | The project repository |
| `/tmp` | Compiler intermediaries, test artifacts, temp files |

Everything else is mounted read-only. Package manager caches (`~/.npm`,
`~/.cache`) are read-only — installs work if `--allow-network` is set
(packages download to `/tmp` or the repo's `node_modules`), but global cache
writes fail silently (cache misses on next run, not a correctness issue).

## Network isolation

Network access is blocked by default via `--unshare-net`. This creates a
network namespace with no interfaces (not even loopback). When
`--allow-network` is passed, `--unshare-net` is omitted and the sandbox
inherits the host's network stack.

Blocked network means:

- `npm install`, `pip install`, `curl`, etc. will fail
- Builds must be fully offline-capable
- Users who need network pass `--allow-network` explicitly

## Error behavior

### Missing bwrap

If `--sandbox` is passed and `bwrap` is not found, the harness throws before
any phase runs. The error message includes the install command. No fallback.

### Sandbox violations

Writes outside the repo and `/tmp` fail with `EROFS` (read-only filesystem).
From the agent's perspective, the command fails with a normal error. No special
handling from Ridgeline — this is the same as any other command failure during
a build.

### Network violations

With network blocked, connection attempts fail with `ENETUNREACH`. Same
behavior — the agent sees a command error and can react or report it.

## User feedback

On startup (before the first phase), print a one-line status:

```text
Sandbox: bwrap (network: blocked)
```

or:

```text
Sandbox: bwrap (network: allowed)
```

Uses the existing `printInfo` function.

## Trajectory logging

Sandbox configuration is included in trajectory entries for `build_start` and
`review_start` events, so post-build analysis can confirm sandboxing was
active.

## Files to create or modify

| File | Action |
|------|--------|
| `src/engine/claude/sandbox.ts` | Create — detection, arg building |
| `src/engine/claude/claude.exec.ts` | Modify — wrap spawn when sandbox enabled |
| `src/engine/pipeline/build.exec.ts` | Modify — pass sandbox opts to invokeClaude |
| `src/engine/pipeline/review.exec.ts` | Modify — pass sandbox opts to invokeClaude |
| `src/types.ts` | Modify — add sandbox/allowNetwork to RidgelineConfig |
| `src/config.ts` | Modify — resolve new CLI opts |
| `src/cli.ts` | Modify — add --sandbox and --allow-network flags |
| `src/commands/build.ts` | Modify — call assertBwrapAvailable before phase loop |
| `SECURITY.md` | Modify — document sandbox feature |

## Platform support

| Platform | Support | Mechanism |
|----------|---------|-----------|
| Linux | Full | `bwrap` (user namespaces) |
| macOS | None | No equivalent unprivileged API |
| WSL2 | Full | Linux kernel, `bwrap` works normally |

## Out of scope

- Config file or env var support for sandbox settings
- Sandboxing the planner, spec wizard, or git operations
- macOS sandboxing (no non-deprecated equivalent exists)
- Env var filtering (agent can still read host env vars inside sandbox)
- CPU/memory limits (handled by existing timeout mechanism)
