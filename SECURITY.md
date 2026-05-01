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

| Agent | Read | Write | Edit | Bash | Glob | Grep | Agent | Web* |
|---------------------|------|-------|------|------|------|------|-------|------|
| Shaper              | yes  | --    | --   | --   | yes  | yes  | --    | --   |
| Designer            | yes  | --    | --   | --   | yes  | yes  | --    | --   |
| Direction-advisor   | yes  | yes   | --   | --   | yes  | yes  | --    | --   |
| Reference-finder    | --   | --    | --   | --   | --   | --   | --    | yes¹ |
| Specifier           | --²  | yes³  | --   | --   | --   | --   | --    | --   |
| Researcher          | --   | yes³  | --   | yes⁴ | --   | --   | --    | yes⁴ |
| Refiner             | yes  | yes   | --   | --   | --   | --   | --    | --   |
| Planner             | --²  | yes³  | --   | --   | --   | --   | --    | --   |
| Plan-reviewer       | --⁵  | --⁵   | --⁵  | --⁵  | --⁵  | --⁵  | --⁵   | --⁵  |
| Builder             | yes  | yes   | yes  | yes  | yes  | yes  | yes   | --   |
| Reviewer            | yes  | --    | --   | yes  | yes  | yes  | yes   | --   |
| Visual-reviewer     | yes  | --    | --   | --   | yes  | yes  | --    | --   |

*\* Web = WebFetch + WebSearch.*
*¹ WebSearch only.*
*² Specialists have no tools (JSON output only).*
*³ Synthesizer only.*
*⁴ Specialists only.*
*⁵ Plan-reviewer is invoked without an explicit `--allowedTools` allowlist; tool
   restraint is enforced by prompt only (the agent's instructions require pure
   JSON output). See "Soft-gated agents" below.*

The **shaper** and **designer** can read the codebase to gather context but
cannot write files or run commands. The **direction-advisor** writes the
generated direction folders (`brief.md`, `tokens.md`, `demo/index.html`)
under `<buildDir>/directions/` and otherwise has read-only access. The
**reference-finder** has only `WebSearch` — it returns image URLs and never
downloads them; the harness performs downloads in TypeScript with a
content-type-aware fetcher (`src/references/download.ts`).

The **researcher** specialists have web access (WebFetch, WebSearch, Bash)
for retrieving external sources; the synthesizer can only write
`research.md`. The research agenda step (sonnet) has no tools — it reasons
from inputs only. The **refiner** reads `research.md`, `spec.md`, and
`spec.changelog.md`, and writes the revised `spec.md` and
`spec.changelog.md` — no Bash or web access.

The **specifier** and **planner** specialists run with no tools and emit
JSON drafts; only their synthesizers can write to disk. The **reviewer**
cannot write or edit files, enforcing a read-only review posture. The
**visual-reviewer** specialist is dispatched by the reviewer via the
`Agent` tool when a phase touches visual code; its allowlist (Read, Glob,
Grep) is enforced by both the reviewer's tool grant and the agent's
frontmatter, so it cannot run commands or modify files.

These restrictions are enforced by the Claude CLI at the tool-call level,
not just by prompt instructions, with the exception of the plan-reviewer
described below.

### Soft-gated agents

The **plan-reviewer** is invoked without an explicit `--allowedTools`
allowlist. Its system prompt requires JSON-only output and forbids any
preamble or commentary, but this is a prompt-level constraint, not a
CLI-enforced one. The plan-reviewer receives only the synthesized plan
plus spec/constraints/taste in its user prompt (no codebase access is
mediated by the harness), so the practical attack surface is limited to
what the model could request through tools the CLI default exposes — but
the harness does not gate this with `--allowedTools`. Tightening this is
tracked as a follow-up.

Specialist sub-agents dispatched at runtime (verifier, explorer, auditor,
tester, visual-reviewer, reference-finder) are constrained by **both**
their parent agent's `--allowedTools` and by their own frontmatter
allowlists. The intersection is what actually applies.

No invocation uses `--dangerously-skip-permissions` or any flag that
bypasses the Claude CLI's permission system.

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

At build start, Ridgeline detects whether Greywall is available:

**Greywall** (macOS and Linux) — if `greywall` is found on PATH, it is used
as the sandbox provider. Greywall provides domain-level network allowlisting,
permitting outbound connections only to explicitly listed domains, and
filesystem write restrictions to the worktree and `/tmp`.

When Greywall is found, sandboxing is **on by default**. The mode is
controlled by `--sandbox <mode>`:

| Mode | Default? | Description |
|------|----------|-------------|
| `semi-locked` | yes | Composes a broad toolchain set (python, ruby, go, rust, cargo, docker) plus path holes for Chromium, agent-browser, uv, and pip caches. Suitable for most builds. |
| `strict` | no | Tighter isolation. Use when you don't need the toolchain expansions and want the smallest possible attack surface. |
| `off` | no | Disables the OS-level sandbox entirely. Falls back to the soft PreToolUse network guard hook. |

`--unsafe` is retained as a deprecated alias for `--sandbox=off`; the legacy
flag prints a deprecation notice and still works.

If Greywall is not installed, Ridgeline prints a warning and proceeds
without a sandbox regardless of the requested mode.

### Network allowlist

The base network allowlist for Greywall is configured in
`.ridgeline/settings.json` under `network.allowlist`. Sensible defaults
(npm, PyPI, GitHub, etc.) are included; extend or restrict them per project.

### Per-build escape hatches

When the active mode doesn't quite cover what a build needs, four keys under
`sandbox.*` in `.ridgeline/settings.json` extend (rather than replace) the
active mode's defaults:

```json
{
  "sandbox": {
    "extraWritePaths": ["/path/the/build/needs/to/write"],
    "extraReadPaths": ["/usr/local/share/some-binary"],
    "extraProfiles": ["additional-greywall-profile"],
    "extraNetworkAllowlist": ["api.example.com"]
  }
}
```

Use these when a phase declares a `## Required Tools` section the active
sandbox mode doesn't satisfy. Prefer extras over `--sandbox=off`: the
extras keep the rest of the protection in place.

### Filesystem isolation

Greywall blocks writes outside the worktree (and a small set of cache and
config paths the toolchain needs) at the kernel level. Combined with the
git-worktree-per-build model, this means a runaway or compromised agent
cannot modify files outside its worktree.

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
adds substantial setup complexity. Instead, Ridgeline uses Greywall as a
sandbox provider that provides network and filesystem restrictions without
containerization overhead. See [Sandbox mode](#sandbox-mode) above.

**Why not full Docker:** Ridgeline is designed for local development workflows
where the builder needs to interact with the project's real toolchain — running
tests, installing dependencies, invoking build systems. Docker would require
mirroring the host's language runtimes, package caches, and environment
configuration, adding substantial setup complexity for marginal benefit in the
intended use case (your own repo, on your own machine).

**Tradeoff:** Greywall is a third-party tool that must be installed
separately. When Greywall is not available, the Claude CLI's permission
system (tool allowlists), worktree isolation, and git checkpoints are the
only safety mechanisms.

### Network access restrictions by default

The default posture is deny-all network access, enforced by the active sandbox
provider:

- **Greywall** allows outbound connections only to domains in the
  `.ridgeline/settings.json` allowlist. All other outbound traffic is blocked
  at the network layer. This applies in both `semi-locked` and `strict` modes.
- With **`--sandbox=off`** (or its deprecated alias `--unsafe`), no sandbox
  network restriction applies. A PreToolUse hook runs as a soft layer that
  intercepts and blocks obvious network commands (`curl`, `wget`,
  `git clone` to remote URLs, etc.), but this is not a kernel-level
  enforcement and can be circumvented by a determined builder.

**Tradeoff:** With `--sandbox=off`, there is no hard mechanism to prevent the
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

When running under Greywall, the sandbox blocks writes outside the
worktree (and a small set of toolchain cache/config paths) at the kernel
level. Without Greywall, worktree isolation is the primary filesystem
boundary.

**Tradeoff:** Worktree isolation alone does not prevent the builder from
writing outside the worktree on the host filesystem when running without
Greywall (e.g., when Greywall is not installed, or `--sandbox=off`). Git
checkpoints within the worktree protect tracked files; files outside the
worktree are not covered.

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

- **Install Greywall** — `brew install greywall` (macOS or Linux) enables
  domain-level network allowlisting and filesystem isolation. Sandbox mode
  is on by default (`semi-locked`) when Greywall is detected.
- **Use `--sandbox=off` only when necessary** — opting out removes
  kernel-level network and filesystem protections and falls back to a
  prompt-based PreToolUse hook only. Prefer `sandbox.extra*` settings to
  punch precise holes rather than disabling the sandbox wholesale. The
  `--unsafe` flag is a deprecated alias for `--sandbox=off`.
- **Try `--sandbox=strict` for sensitive builds** — strict mode trims the
  toolchain expansions in `semi-locked` and minimizes the attack surface.
  Fall back to `semi-locked` if a phase needs a tool the strict mode
  doesn't permit.
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
