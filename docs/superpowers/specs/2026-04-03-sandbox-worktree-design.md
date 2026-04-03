# Sandbox Auto-Detection, Worktree Isolation, and Network Guard

Design spec for three layered security improvements to Ridgeline's build
pipeline.

## Overview

Ridgeline currently relies on opt-in bwrap sandboxing (Linux only) and prompt-
level instructions for constraining agent behavior. This design closes the macOS
gap, adds filesystem isolation via git worktrees, and provides a fallback
network guard hook for unsandboxed builds.

**Three independent features, implemented in sequence:**

1. **Sandbox abstraction layer** — auto-detect Greywall (macOS/Linux) or bwrap
   (Linux), sandbox by default, opt-out via `--unsafe`
2. **Worktree-per-build** — isolate in-progress phase work from the user's tree,
   reflect completed phases back immediately
3. **PreToolUse network guard hook** — catch network-capable bash commands when
   running in `--unsafe` mode

## Decisions

- Sandbox is on by default when a provider is detected. `--unsafe` opts out.
- Greywall and bwrap are external dependencies (like git). Ridgeline does not
  ship them.
- Network allowlist: sensible defaults, user overrides via
  `.ridgeline/settings.json`. User list replaces defaults entirely.
- Worktree and sandbox are independent features. `--unsafe` disables only the
  sandbox. Worktrees are always used.
- PreToolUse hook is only loaded in `--unsafe` mode. No double enforcement.
- Worktree commits are reflected back to the user's branch as each phase
  completes. The user sees real-time progress.
- Failed/halted worktrees are left for inspection. Resumed builds try the
  existing worktree first, recreate from checkpoint if broken.

## Feature 1: Sandbox Abstraction Layer

### Provider Interface

```typescript
type SandboxProvider = {
  name: "bwrap" | "greywall"
  command: string            // executable name, e.g. "bwrap" or "greywall"
  buildArgs: (repoRoot: string, networkAllowlist: string[]) => string[]
}
```

Each provider returns the full argument array needed to wrap a `claude`
invocation. The caller prepends the provider's command and appends `claude`
plus its own args.

### Auto-Detection

Detection runs once at build start. Priority order:

1. **Greywall** — works on macOS and Linux, supports domain-level network
   allowlisting. Checked via `which greywall`.
2. **Bwrap** — Linux only, binary network toggle (on/off, no domain filtering).
   Checked via `which bwrap`.
3. **None** — no sandbox available. Build proceeds unsandboxed with a warning.

If `--unsafe` is set, detection is skipped entirely.

### Bwrap Provider

Extracted from the current `sandbox.ts`. Behavior unchanged:

```typescript
buildArgs(repoRoot: string, _networkAllowlist: string[]): string[] {
  return [
    "--ro-bind", "/", "/",
    "--bind", repoRoot, repoRoot,
    "--bind", "/tmp", "/tmp",
    "--dev", "/dev",
    "--proc", "/proc",
    "--die-with-parent",
    "--unshare-net",
  ]
}
```

Bwrap always blocks network (`--unshare-net`). It does not support domain-level
allowlisting. The `networkAllowlist` parameter is ignored.

### Greywall Provider

```typescript
buildArgs(repoRoot: string, networkAllowlist: string[]): string[] {
  const args = [
    "--allow-dir", repoRoot,
    "--allow-dir", "/tmp",
  ]
  for (const domain of networkAllowlist) {
    args.push("--allow-network", domain)
  }
  args.push("--")
  return args
}
```

Greywall supports domain-level network allowlisting natively. Each allowed
domain is passed as a separate `--allow-network` flag.

Note: The exact Greywall CLI flags must be verified during implementation.
The above is based on research and may need adjustment.

### claude.exec.ts Changes

The current branching logic:

```typescript
const spawnCmd = opts.sandbox ? "bwrap" : "claude"
const spawnArgs = opts.sandbox
  ? [...buildBwrapArgs(opts.cwd, opts.allowNetwork ?? false), "claude", ...args]
  : args
```

Becomes:

```typescript
const provider = opts.sandboxProvider  // SandboxProvider | null
const spawnCmd = provider ? provider.command : "claude"
const spawnArgs = provider
  ? [...provider.buildArgs(opts.cwd, opts.networkAllowlist), "claude", ...args]
  : args
```

The `InvokeOptions` type replaces `sandbox: boolean` and
`allowNetwork: boolean` with `sandboxProvider: SandboxProvider | null` and
`networkAllowlist: string[]`.

### Settings and Network Allowlist

#### .ridgeline/settings.json

New project-level configuration file:

```json
{
  "network": {
    "allowlist": [
      "registry.npmjs.org",
      "pypi.org",
      "files.pythonhosted.org",
      "crates.io",
      "static.crates.io",
      "rubygems.org",
      "proxy.golang.org",
      "github.com",
      "gitlab.com",
      "bitbucket.org"
    ]
  }
}
```

#### Resolution

1. Load built-in defaults (the list above, hardcoded in Ridgeline)
2. Load `.ridgeline/settings.json` if it exists
3. If user specifies `network.allowlist`, it **replaces** defaults entirely
4. If user omits the `network` key, defaults apply

Replace semantics (not merge) so users can lock down to exactly the domains
they need without explicitly denying defaults.

#### Settings Loader

New file: `src/store/settings.ts`

```typescript
type RidgelineSettings = {
  network?: {
    allowlist?: string[]
  }
}
```

Loaded once during `resolveConfig()`. The resolved allowlist flows into
`RidgelineConfig.networkAllowlist`.

#### When --unsafe Is Set

The allowlist is irrelevant — there is no sandbox to enforce it. The fallback
hook (Feature 3) blocks network commands outright rather than allowlisting
domains.

## Feature 2: Worktree Isolation

### Lifecycle

**Build start:**

1. Create worktree: `git worktree add .ridgeline/worktrees/<build-name> -b ridgeline/wip/<build-name>`
2. Copy state files (`.env`, config files the project needs) into the worktree
3. Pass worktree path as `cwd` to `invokeClaude()` instead of `process.cwd()`

**Phase completes successfully:**

1. Builder commits in the worktree (existing git checkpoint behavior)
2. Fast-forward the user's branch: `git merge --ff-only ridgeline/wip/<build-name>`
3. If fast-forward fails (user changed their branch mid-build), fall back to
   regular merge

**Phase fails or build is halted:**

1. Worktree left in place at `.ridgeline/worktrees/<build-name>`
2. User can inspect: `cd .ridgeline/worktrees/<build-name>`

**Build resumes:**

1. Check if `.ridgeline/worktrees/<build-name>` exists
2. If usable (valid HEAD, branch exists): resume from there
3. If broken: remove worktree, recreate from last checkpoint tag

**All phases complete:**

1. Final fast-forward/merge to user's branch
2. Remove worktree: `git worktree remove .ridgeline/worktrees/<build-name>`
3. Delete WIP branch: `git branch -d ridgeline/wip/<build-name>`

### New File: src/engine/worktree.ts

Handles: create, validate, reflect-commits-back, cleanup.

### Integration

The only change to build/review executors is the `cwd` passed to
`invokeClaude()`. The worktree is transparent to the agent — it sees a normal
git repo.

All `git.ts` helpers already accept an optional `cwd` parameter. No changes
needed.

### No Opt-Out

Worktrees are always used during builds. They are lightweight, transparent, and
protect the user's working tree from half-finished work. There is no flag to
disable them.

### ridgeline clean Command

New CLI command that removes all worktrees under `.ridgeline/worktrees/` and
their associated `ridgeline/wip/*` branches.

## Feature 3: PreToolUse Network Guard Hook

### Activation

Only loaded when `config.unsafe === true`. When a sandbox is active, the hook
is not included in plugin directories — no double enforcement.

### Hook File

Shipped with Ridgeline at `src/agents/core/hooks/network-guard.md`:

```markdown
---
event: PreToolUse
tool: Bash
---
Block any bash command that makes outbound network requests.

Deny commands containing: curl, wget, nc, ncat, netcat, ssh, scp, sftp,
rsync (with remote paths), python -m http.server, node -e with http/https
modules, telnet, ftp.

Allow these exceptions:
- npm install, npm ci, npm update
- npx (any arguments)
- pip install, pip3 install
- cargo build, cargo install
- gem install, bundle install
- go get, go install, go mod download
- git fetch, git pull, git clone, git push
- brew install

If the command is blocked, return "block" with a message explaining that
network access is restricted in unsafe mode. Suggest using an allowed
package manager command instead.
```

### Loading

The hook's plugin directory is conditionally included in `pluginDirs` when
`config.unsafe === true`. Uses the existing `discoverPluginDirs()` /
`--plugin-dir` mechanism.

## CLI and Config Changes

### CLI Flags

| Current | New | Notes |
|---------|-----|-------|
| `--sandbox` | *(removed)* | Auto-detected, on by default |
| `--allow-network` | *(removed)* | Allowlist via settings.json |
| *(none)* | `--unsafe` | Disables sandbox, enables hook fallback |
| *(none)* | `ridgeline clean` | Remove stale worktrees and WIP branches |

### RidgelineConfig Type

```typescript
// Remove:
sandbox: boolean
allowNetwork: boolean

// Add:
unsafe: boolean
networkAllowlist: string[]
worktreePath: string | null  // resolved at build start, null for plan/spec
```

### New Files

| File | Purpose |
|------|---------|
| `src/engine/claude/sandbox.ts` | Provider interface, auto-detection, defaults |
| `src/engine/claude/sandbox.bwrap.ts` | Bwrap provider (extracted) |
| `src/engine/claude/sandbox.greywall.ts` | Greywall provider |
| `src/store/settings.ts` | Load/parse .ridgeline/settings.json |
| `src/engine/worktree.ts` | Worktree lifecycle |
| `src/commands/clean.ts` | ridgeline clean command |
| `src/agents/core/hooks/network-guard.md` | PreToolUse hook for unsafe mode |

### Modified Files

| File | Change |
|------|--------|
| `src/engine/claude/claude.exec.ts` | Use sandbox provider instead of bwrap branch |
| `src/engine/pipeline/build.exec.ts` | Pass worktree cwd |
| `src/engine/pipeline/review.exec.ts` | Pass worktree cwd |
| `src/commands/build.ts` | Worktree setup/teardown, sandbox detection logging |
| `src/config.ts` | Load settings.json, resolve new config fields |
| `src/cli.ts` | Replace flags, add clean command |
| `src/types.ts` | Update RidgelineConfig type |
| `SECURITY.md` | Update to reflect new security model |
| `docs/help.md` | Update CLI reference |

### Backward Compatibility

The `--sandbox` and `--allow-network` flags are removed. This is a breaking
change. Ridgeline is pre-1.0 (v0.2.9), so this is acceptable. The new behavior
is strictly better — sandbox by default is safer than opt-in.

## Implementation Order

1. **Sandbox abstraction** — provider interface, bwrap extraction, greywall
   provider, auto-detection, settings.json, CLI changes
2. **Worktree isolation** — worktree lifecycle, build loop integration,
   reflect-commits, resume logic, clean command
3. **Network guard hook** — hook file, conditional loading in unsafe mode
