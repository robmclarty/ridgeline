# Security

Ridgeline orchestrates AI agents that read and write code in your repository.
This document describes the security mechanisms in place, the threat model, and
the tradeoffs behind our design decisions.

## Threat model

Ridgeline assumes:

- You are running it on a **trusted local machine** inside a repository you own.
- The **Claude CLI** is installed from a legitimate source and authenticated.
- The **spec, constraints, and taste files** are authored or reviewed by you.
- The underlying operating system and filesystem are not compromised.

Ridgeline does **not** attempt to defend against a malicious Claude CLI binary,
a compromised OS, or adversarial modifications to its own source code.

## Permission scoping

Each agent is invoked with an explicit `--allowedTools` flag that limits which
Claude CLI tools it can use. The permission matrix:

| Agent | Read | Write | Edit | Bash | Glob | Grep | Agent |
|------------|------|-------|------|------|------|------|-------|
| Shaper     | yes  | --    | --   | --   | yes  | yes  | --    |
| Specifier  | yes  | yes   | --   | --   | yes  | yes  | --    |
| Planner    | --   | yes   | --   | --   | --   | --   | --    |
| Builder    | yes  | yes   | yes  | yes  | yes  | yes  | yes   |
| Reviewer   | yes  | --    | --   | yes  | yes  | yes  | yes   |

The **shaper** can read the codebase to gather context but cannot write files
or run commands. The **planner** can only write phase files — it cannot read
the codebase or execute commands. The **reviewer** cannot write or edit files,
enforcing a read-only review posture. These restrictions are enforced by the
Claude CLI at the tool-call level, not just by prompt instructions.

Specialist sub-agents (verifier, scout, auditor, tester) are also constrained by
their parent's tool allowlist and by their own system prompts which instruct
read-only behavior.

No invocation uses `--dangerously-skip-permissions` or any flag that bypasses
the Claude CLI's permission system.

## Git checkpoints

Before each phase begins, Ridgeline:

1. Commits any dirty working tree state (`chore: pre-phase checkpoint`).
2. Creates a git tag at that commit: `ridgeline/checkpoint/<build>/<phase>`.

If a phase fails or produces unwanted changes, you can roll back:

```sh
git reset --hard ridgeline/checkpoint/<build>/<phase>
```

On successful completion, a separate tag is created:
`ridgeline/phase/<build>/<phase>`. The harness verifies this tag exists
before treating a phase as complete — if the tag was deleted or the git
history was rewritten, the phase is re-marked as pending.

## Budget controls

Every Claude invocation records its token usage and cost in `budget.json`.
When `--max-budget-usd` is set, the harness checks cumulative cost after each
build step and halts the pipeline if the limit is exceeded. This prevents
runaway spending during long builds or retry loops.

## Timeout enforcement

All Claude invocations are subject to a configurable timeout (default: 120
minutes per phase). When the timeout fires:

1. The process receives `SIGTERM`.
2. After 5 seconds, if still running, it receives `SIGKILL`.

Check commands have a separate timeout (`--check-timeout`, default: 1200
seconds) to prevent hung test suites from blocking the pipeline indefinitely.

## Retry limits

Failed phases are retried up to `--max-retries` times (default: 2). Combined
with budget limits and timeouts, this bounds the total cost and duration of any
single build, even when the builder repeatedly fails review.

## Sandbox mode

At build start, Ridgeline auto-detects an available sandbox provider:

1. **Greywall** (macOS and Linux) — if `greywall` is found on PATH, it is used
   as the sandbox provider. Greywall provides domain-level network allowlisting,
   permitting outbound connections only to explicitly listed domains.
2. **bwrap** (Linux) — if Greywall is not available but
   [bubblewrap](https://github.com/containers/bubblewrap) is installed, it is
   used instead. bwrap blocks all outbound network via Linux network namespaces
   with no domain-level filtering.

When a provider is found, sandboxing is **on by default**. Pass `--unsafe` to
opt out. If no provider is found, Ridgeline prints a warning and proceeds
without a sandbox.

The network allowlist for Greywall is configured in
`.ridgeline/settings.json` under `network.allowlist`. Sensible defaults
(npm, PyPI, GitHub, etc.) are included; extend or restrict them per project.

bwrap additionally mounts the filesystem read-only, with only the worktree
and `/tmp` writable. `--die-with-parent` ensures the sandbox is torn down if
Ridgeline exits unexpectedly.

## Verdict parsing

The reviewer outputs a structured JSON verdict. The harness parses this
defensively:

- Tries extracting JSON from a fenced code block first.
- Falls back to brute-force scanning for balanced `{}`  pairs.
- If no valid JSON is found, defaults to `passed: false` with a descriptive
  error — the pipeline never silently treats an unparseable verdict as success.

## Prompt architecture

Agent system prompts are **fixed files** shipped with Ridgeline
(`src/agents/core/`). They are not user-configurable and cannot be modified at
runtime. User-provided content (spec, constraints, taste, feedback) is
assembled into the **user prompt** as clearly delimited sections — it is not
interpolated into the system prompt.

This separation reduces (but does not eliminate — see limitations below) the
risk of prompt injection through user-authored spec files.

## State integrity

Phase state is tracked in `state.json` with explicit status fields (`pending`,
`building`, `reviewing`, `complete`, `failed`). State transitions are logged to
`trajectory.jsonl` as append-only NDJSON entries, creating an audit trail of
every build and review invocation, including token counts, costs, and durations.

On resume, the harness cross-references `state.json` against git tags. If a
completion tag is missing (e.g., after a `git reset`), the phase is re-marked
as pending rather than skipped.

## Plugin and agent discovery

Ridgeline discovers specialist agents from its own `agents/specialists/`
directory using frontmatter validation. Only files with valid `name` and
`description` fields are loaded. Temporary `plugin.json` files created for
Claude CLI plugin discovery are cleaned up after each invocation, and cleanup
only targets files Ridgeline itself created (identified by an auto-generated
marker).

## What we chose not to implement

### Container isolation (Docker/VM sandboxing)

The builder agent has access to `Bash`, `Write`, and `Edit` — it can execute
arbitrary commands and modify any file in the repository. Full container
isolation (Docker/VM) would sandbox the filesystem and network completely, but
adds substantial setup complexity. Instead, Ridgeline uses auto-detected
sandbox providers (Greywall or bwrap) that provide network and filesystem
restrictions without containerization overhead. See [Sandbox mode](#sandbox-mode)
above.

**Why not full Docker:** Ridgeline is designed for local development workflows
where the builder needs to interact with the project's real toolchain — running
tests, installing dependencies, invoking build systems. Docker would require
mirroring the host's language runtimes, package caches, and environment
configuration, adding substantial setup complexity for marginal benefit in the
intended use case (your own repo, on your own machine).

**Tradeoff:** bwrap filesystem sandboxing is Linux-only. On macOS, Greywall
provides network-level restrictions but not filesystem isolation below the
worktree layer. The Claude CLI's permission system (tool allowlists), worktree
isolation, and git checkpoints remain the primary safety mechanisms on all
platforms.

### Network access restrictions by default

The default posture is deny-all network access, enforced by the active sandbox
provider:

- **Greywall** allows outbound connections only to domains in the
  `.ridgeline/settings.json` allowlist. All other outbound traffic is blocked
  at the network layer.
- **bwrap** blocks all outbound network with no domain filtering — the builder
  cannot reach the network at all unless the sandbox is bypassed.
- In **`--unsafe` mode**, no sandbox network restriction applies. A PreToolUse
  hook runs as a soft layer that intercepts and blocks obvious network commands
  (`curl`, `wget`, `git clone` to remote URLs, etc.), but this is not a
  kernel-level enforcement and can be circumvented by a determined builder.

**Tradeoff:** In `--unsafe` mode, there is no hard mechanism to prevent the
builder from exfiltrating repository contents or downloading untrusted code.
Users should review phase specs before building and use budget limits to bound
the scope of any single invocation.

### Git commit signing

Ridgeline creates commits and tags without GPG or SSH signatures.

**Why we didn't:** Signing requires per-user key configuration that Ridgeline
shouldn't assume or mandate. Users who want signed commits can configure git
globally (`git config commit.gpgsign true`), and Ridgeline's commits will
inherit that setting.

**Tradeoff:** Without signing, there is no cryptographic proof that checkpoint
commits were created by Ridgeline rather than modified after the fact.

### Filesystem write restrictions

Each build runs inside a dedicated git worktree, providing a layer of
filesystem isolation that protects the user's working tree from in-progress
agent writes:

- The builder operates within the worktree, not the main checkout. The user's
  working tree remains clean for the duration of the build.
- On successful phase completion, changes are reflected back to the user's
  branch via fast-forward merge.
- On failure, the worktree is left in place for inspection. Run
  `ridgeline clean` to remove stale worktrees once you are done.

When running under bwrap, the sandbox additionally mounts the host filesystem
read-only, restricting writes to the worktree and `/tmp` at the kernel level.
Under Greywall (no bwrap), worktree isolation is the primary filesystem
boundary.

**Tradeoff:** Worktree isolation does not prevent the builder from writing
outside the worktree on the host filesystem when running without bwrap (e.g.,
macOS or `--unsafe`). Git checkpoints within the worktree protect tracked
files; files outside the worktree are not covered.

### Encrypted state files

Build state (`state.json`, `budget.json`, `trajectory.jsonl`) is stored as
plain-text JSON. We considered encrypting these files.

**Why we didn't:** These files contain operational metadata (phase statuses,
cost totals, event logs), not secrets. They are designed to be human-readable
for debugging and auditing. The spec, constraints, and taste files are also
plain markdown authored by the user.

**Tradeoff:** If the repository is shared or public, build metadata is visible.
This is by design — Ridgeline state lives inside `.ridgeline/` and follows the
same visibility rules as the rest of the repo.

## Recommendations for users

- **Install a sandbox provider** — on macOS, install Greywall
  (`brew install greywall`) for domain-level network allowlisting. On Linux,
  install `bwrap` if Greywall is not available. Sandbox mode is on by default
  when a provider is detected.
- **Use `--unsafe` only when necessary** — opting out of sandboxing removes
  kernel-level network and filesystem protections. Understand the reduced
  guarantees before using it.
- **Set a budget limit** — use `--max-budget-usd` to cap spending, especially
  on first runs or large specs.
- **Preview before building** — use `ridgeline dry-run` to inspect the plan
  before committing to a full build.
- **Review phase specs** — the planner's output determines what the builder
  will do. Read the phase files in `phases/` before running `build`.
- **Use a clean branch** — run builds on a feature branch so `main` is never
  at risk.
- **Clean up stale worktrees** — after inspecting a failed build, run
  `ridgeline clean` to remove leftover worktrees.
- **Check your constraints** — a good `## Check Command` in `constraints.md`
  is your strongest guardrail. It runs after every build step and determines
  whether the reviewer sees a passing baseline.
- **Keep the Claude CLI updated** — security improvements and permission
  enforcement fixes ship with new CLI versions.

## Reporting vulnerabilities

If you discover a security issue in Ridgeline, please open an issue on the
GitHub repository. For sensitive disclosures, contact the maintainer directly
rather than filing a public issue.
