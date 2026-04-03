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
| Specifier  | yes  | yes   | --   | --   | yes  | yes  | --    |
| Planner    | --   | yes   | --   | --   | --   | --   | --    |
| Builder    | yes  | yes   | yes  | yes  | yes  | yes  | yes   |
| Reviewer   | yes  | --    | --   | yes  | yes  | yes  | yes   |

The **planner** can only write phase files — it cannot read the codebase or
execute commands. The **reviewer** cannot write or edit files, enforcing a
read-only review posture. These restrictions are enforced by the Claude CLI at
the tool-call level, not just by prompt instructions.

Specialist sub-agents (navigator, depender, tester) are also constrained by
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

## Sandbox mode (Linux)

When `--sandbox` is passed to `ridgeline build`, each Claude CLI invocation
(builder and reviewer) runs inside a [bubblewrap](https://github.com/containers/bubblewrap)
sandbox. This enforces kernel-level restrictions:

- **Filesystem:** The entire filesystem is mounted read-only. Only the
  repository root and `/tmp` are writable. Writes anywhere else fail with
  `EROFS`.
- **Network:** Outbound network access is blocked by default via Linux network
  namespaces. Pass `--allow-network` to permit it for builds that need
  dependency installation or API access.
- **Process isolation:** `--die-with-parent` ensures the sandbox is torn down
  if Ridgeline exits unexpectedly.

Sandboxing requires `bwrap` to be installed. If it is not found, the harness
errors immediately — there is no silent fallback. This feature is Linux-only;
macOS lacks equivalent unprivileged namespace support.

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
adds substantial setup complexity. Instead, Ridgeline offers opt-in `--sandbox`
mode using bubblewrap (`bwrap`) on Linux, which provides kernel-level
filesystem and network restrictions without containerization overhead. See
[Sandbox mode](#sandbox-mode-linux) above.

**Why not full Docker:** Ridgeline is designed for local development workflows
where the builder needs to interact with the project's real toolchain — running
tests, installing dependencies, invoking build systems. Docker would require
mirroring the host's language runtimes, package caches, and environment
configuration, adding substantial setup complexity for marginal benefit in the
intended use case (your own repo, on your own machine).

**Tradeoff:** `bwrap` sandboxing is Linux-only. On macOS, there is no
equivalent unprivileged namespace API, so builds run without filesystem
isolation. The Claude CLI's permission system (tool allowlists) and git
checkpoints remain the primary safety mechanisms on all platforms.

### Network access restrictions by default

The builder can make network requests (e.g., `curl`, `npm install`,
`git clone`) through its `Bash` tool access. On Linux, `--sandbox` blocks
network by default — users must opt in with `--allow-network`. On macOS and
when running without `--sandbox`, network access is unrestricted.

**Why not restrict by default everywhere:** Most real build steps require
network access — installing dependencies, fetching remote resources, running
integration tests against external services. Network namespaces are a
Linux-only kernel feature with no macOS equivalent.

**Tradeoff:** Without `--sandbox`, there is no mechanism to prevent the builder
from exfiltrating repository contents or downloading untrusted code. Users
should review phase specs before building and use budget limits to bound the
scope of any single invocation.

### Git commit signing

Ridgeline creates commits and tags without GPG or SSH signatures.

**Why we didn't:** Signing requires per-user key configuration that Ridgeline
shouldn't assume or mandate. Users who want signed commits can configure git
globally (`git config commit.gpgsign true`), and Ridgeline's commits will
inherit that setting.

**Tradeoff:** Without signing, there is no cryptographic proof that checkpoint
commits were created by Ridgeline rather than modified after the fact.

### Filesystem write restrictions

The builder can write to any path accessible to the current user, not just
files within the project directory.

**Why we didn't:** Many legitimate build operations write outside the project
root — global tool installations, cache directories, temporary files. Path
allowlisting would require maintaining per-project policy that is difficult to
get right without breaking real workflows.

**Tradeoff:** A confused builder could overwrite files outside the repository.
Git checkpoints only protect tracked files within the repo.

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

- **Set a budget limit** — use `--max-budget-usd` to cap spending, especially
  on first runs or large specs.
- **Preview before building** — use `ridgeline dry-run` to inspect the plan
  before committing to a full build.
- **Review phase specs** — the planner's output determines what the builder
  will do. Read the phase files in `phases/` before running `build`.
- **Use a clean branch** — run builds on a feature branch so `main` is never
  at risk.
- **Check your constraints** — a good `## Check Command` in `constraints.md`
  is your strongest guardrail. It runs after every build step and determines
  whether the reviewer sees a passing baseline.
- **Keep the Claude CLI updated** — security improvements and permission
  enforcement fixes ship with new CLI versions.

## Reporting vulnerabilities

If you discover a security issue in Ridgeline, please open an issue on the
GitHub repository. For sensitive disclosures, contact the maintainer directly
rather than filing a public issue.
