# Sandboxing and Access Control

Research into constraining network access and out-of-repo filesystem access for
Ridgeline build agents, with a survey of community tools and patterns.

## Problem Statement

Ridgeline orchestrates Claude CLI agents that can read, write, and execute
arbitrary code. The current security model has a gap:

- **Linux** -- `bwrap` sandbox provides filesystem isolation (repo + /tmp
  writable, everything else read-only) and network blocking via namespaces.
- **macOS** -- No equivalent enforcement. Agents rely on `--allowedTools` and
  prompt instructions, neither of which prevents `Bash(curl ...)` or writing
  outside the repo.

The goal is to close this gap with layered controls that:

1. Restrict network access to package registries and documentation only.
2. Confine filesystem writes to the repo boundary.
3. Work on macOS (where most development happens).
4. Do not require Docker or VMs.

---

## Current Ridgeline Controls (Post-Implementation)

As of v0.3.0, the sandbox and access control system has been implemented. The
controls below reflect the current state.

| Layer | Mechanism | Enforcement |
|-------|-----------|-------------|
| Tool allowlist | `--allowedTools` per role | Hard -- Claude CLI strips disallowed tools |
| Prompt instructions | Agent system prompts | Soft -- model compliance only |
| Sandbox auto-detection | Greywall (macOS/Linux) or bwrap (Linux) | Hard -- OS-level isolation |
| Network allowlist | `.ridgeline/settings.json` via sandbox | Hard -- sandbox enforces domain list |
| Worktree isolation | Git worktrees per build | Hard -- filesystem isolation |
| Budget cap | `--max-budget-usd` | Hard -- CLI enforces |
| Timeout | `--timeout`, `--check-timeout` | Hard -- SIGTERM/SIGKILL |
| Network guard hook | PreToolUse hook in `--unsafe` mode only | Soft -- prompt-based judgment |

Sandboxing is **on by default** when a provider (Greywall or bwrap) is detected
in the environment. Use `--unsafe` to opt out. Worktrees are always used.

---

## OS-Level Sandboxing Tools

### Greywall

**Repo:** `GreyhavenHQ/greywall` (126 stars, Go, Apache 2.0)

Container-free, deny-by-default sandbox for AI coding agents on Linux and macOS.
All filesystem access and network connections are blocked unless explicitly
allowed. Network traffic routes through `greyproxy`, a transparent proxy with a
live allow/deny dashboard.

**Key features:**

- Deny-by-default filesystem -- only the working directory is accessible
- Network isolation via transparent proxy with domain allowlists
- Command blocking (`rm -rf /`, `git push --force`, etc.)
- Built-in profiles for Claude Code, Codex, Cursor, Aider, and 13+ other agents
- **Learning mode** -- traces actual access via `strace`/`eslogger` and
  auto-generates least-privilege profiles
- Five security layers on Linux (bwrap, Landlock, Seccomp BPF, eBPF, TUN)

**Install:** `brew tap greyhavenhq/tap && brew install greywall`

**Usage:** `greywall -- claude <args>`

**Relevance:** Direct replacement for bwrap on macOS. Ridgeline could invoke
`greywall -- claude` instead of bare `claude` in `claude.exec.ts`, mirroring
the existing bwrap integration pattern. The learning mode solves the "what
domains does my build actually need?" problem -- run once in learning mode, then
enforce the generated profile.

### Pent

Lightweight process containment with domain allowlists and filesystem path
allowlists. Pre-built profiles for `@claude`, `@npm`, `@gh`, `@pip`, `@cargo`.
Uses native OS mechanisms (no containers). Could not locate a public repository
at time of research -- may be private or pre-release.

### Cage

macOS-specific tool using Apple's `sandbox-exec` profiles and a forward proxy
for domain whitelisting. YAML-based profile configuration. Minimal community
traction.

### eatmynetwork (Trail of Bits)

**Repo:** `trailofbits/eatmynetwork` (55 stars)

A POSIX shell script wrapping `sandbox-exec` on macOS (network namespaces on
Linux) to run any command with zero network access. Not an allowlist -- a full
network kill switch. Useful for phases that should never touch the network.

**Comparison:**

| Tool | macOS | Linux | Network allowlist | FS isolation | Learning mode |
|------|-------|-------|-------------------|--------------|---------------|
| Greywall | Yes | Yes | Yes (greyproxy) | Yes | Yes |
| Pent | Yes | Yes | Yes (domains) | Yes (paths) | No |
| Cage | Yes | No | Yes (domains) | No | No |
| eatmynetwork | Yes | Yes | No (kill switch) | No | No |
| bwrap (current) | No | Yes | No (kill switch) | Yes | No |

---

## MCP-Level Filtering

### mcp-filter

**Repo:** `pro-vi/mcp-filter` (47 stars)

Proxy MCP server that only exposes allowlisted tools from an upstream server.
Drop-in for any stdio or HTTP/SSE MCP server. Reduces token usage by removing
tool definitions the agent does not need.

### tool-filter-mcp

**Repo:** `respawn-app/tool-filter-mcp` (34 stars)

Similar to mcp-filter but uses regex-based deny lists instead of allowlists.

### Custom filtered MCP server

A Ridgeline-specific MCP server could expose only:

- `install_package(name, registry)` -- npm, pip, cargo, etc.
- `fetch_docs(library, version)` -- documentation lookups
- `fetch_url(url)` -- with URL pattern allowlisting

This would replace `WebFetch`/`WebSearch` with controlled alternatives. Combined
with removing those tools from `allowedTools`, agents would have no way to make
arbitrary network requests through Claude's built-in tools.

**Limitation:** MCP filtering does not prevent `Bash(curl ...)`. Must combine
with OS-level sandboxing or hook-based command interception.

---

## Hook-Based Command Interception

Claude Code supports `PreToolUse` hooks that can intercept and block tool calls.
A hook at `.ridgeline/plugin/hooks/network-guard.md` could:

```markdown
---
event: PreToolUse
tool: Bash
---
Block any bash command that makes network requests (curl, wget, nc, ssh, etc.)
unless it matches an allowlisted pattern: npm install, npm ci, pip install,
cargo build, git fetch, git pull, git clone.
Return "block" with explanation if unauthorized.
```

**Trade-off:** Hook evaluation is prompt-based (an LLM judges whether to block).
This is not a security boundary -- determined adversarial prompting can bypass
it. It is a strong additional layer for catching accidental or unsophisticated
network access.

---

## Filesystem Isolation via Git Worktrees

Git worktrees create a separate working directory with its own checked-out branch
while sharing the same `.git` repository. Each agent gets its own filesystem
scope without duplicating the repo.

**Pattern:**

```sh
git worktree add .worktrees/build-phase-3 -b phase-3
# launch agent pointed at .worktrees/build-phase-3
# review and merge (or discard) when done
git worktree remove .worktrees/build-phase-3
```

**Benefits for Ridgeline:**

- Each build phase operates in isolation -- changes do not affect the main tree
  until explicitly merged
- Parallel agents cannot step on each other's files
- Failed builds are trivially discarded (remove the worktree)
- Combined with Greywall filesystem allowlists, the agent can only write within
  its worktree directory

**Practical details:**

- State files (`.env`, config) must be copied into each worktree
- `node_modules` and other large dependency directories should be symlinked or
  shared to avoid duplication
- Worktree cleanup should be automated (remove on pipeline completion)

---

## Community Project Survey

### Orchestrators and Coordination Tools

#### consensus-loop / quorum

**Repo:** `berrzebb/consensus-loop` (13 stars) -- evolved into `berrzebb/quorum`

Cross-model audit gates. Claude implements code in an isolated worktree, then a
different model (GPT/Codex) independently reviews. Nothing merges without
auditor sign-off -- the author model cannot approve its own work.

**Notable ideas:**

- **Fitness score engine** -- measures type safety, test coverage, build health,
  complexity, security, and dependencies as a 0.0-1.0 score. Gates expensive LLM
  review with auto-reject/self-correct/proceed thresholds. "What is measurable
  is not asked to the LLM."
- **13-factor conditional trigger** -- not every change needs full audit. A
  scoring system determines skip/simple/deliberative audit tiers, saving cost on
  trivial changes.
- **RTM (Requirements Traceability Matrix)** -- deterministic MCP tools generate
  3-way traceability before implementation. Pure tooling, not LLM inference.
- **Deliberative consensus** -- for complex changes, runs Advocate / Devil's
  Advocate / Judge protocol.
- **Wave-based execution** -- tasks in dependency-ordered waves with per-wave
  audit and fixer agents.

**Comparison to Ridgeline:** Quorum focuses on review quality and traceability
enforcement. Ridgeline covers the full spec-to-build pipeline. The fitness score
gating and conditional trigger systems could reduce Ridgeline's review costs
significantly -- most changes do not need expensive multi-pass review.

#### ccswarm

**Repo:** `nwiizo/ccswarm` (133 stars, Rust)

Rust-native workflow automation for coordinating specialized AI agents via Claude
CLI. Provides task delegation, template scaffolding, git worktree isolation,
native PTY sessions, and a TUI dashboard.

**Notable ideas:**

- Type-state pattern for compile-time state validation
- Channel-based orchestration without shared mutable state
- OpenTelemetry export for observability (Jaeger/Zipkin/Langfuse)
- DAG-based task dependency graph with conditional execution

**Comparison to Ridgeline:** ccswarm is more general-purpose (any workflow, not
just builds) and more ambitious in scope, but many core features are stubs.
Ridgeline is narrower and more complete. The observability layer and DAG
workflow patterns are worth studying.

#### fellowship

**Repo:** `justinjdev/fellowship` (5 stars, Go + Markdown)

Multi-task workflows through Research -> Plan -> Implement -> Review -> Complete
lifecycle. Parallel agent "quests" in isolated worktrees, coordinated by a lead
agent. Hard gate enforcement via compiled Go binary hooks.

**Notable ideas:**

- **Structural gate enforcement** -- after submission, work tools (Edit, Write,
  Bash) are blocked by hooks until the lead approves. Self-approval is
  structurally impossible. Compliance went from ~33% (prompt-only) to ~95%+.
- **Mandatory context compression** (`/lembas`) between every phase. Keeps the
  context window in the "reasoning sweet spot."
- **SQLite state** -- eliminated race conditions that JSON files caused in
  parallel quests.
- **Palantir monitoring agent** -- background agent watching for stuck quests,
  scope drift, and file conflicts.
- **Bulletin board** -- cross-quest knowledge sharing during parallel execution.
- **Quest autopsy** -- failure memory persisting across sessions.
- **Retro skill** -- post-fellowship retrospective analyzing gate history and
  metrics, recommending config changes.

**Comparison to Ridgeline:** Fellowship is the closest community project to
Ridgeline's architecture. The key difference is that fellowship operates within
a single Claude Code session (plugin-based), while Ridgeline orchestrates
external CLI invocations. Fellowship's structural gate enforcement and context
compression patterns are directly applicable.

#### spinoff

**Repo:** `CRJFisher/spinoff` (2 stars, Python)

Plugin that spins off autonomous Claude agents into isolated git worktrees with
sandbox mode and dedicated terminal workspaces.

**Notable ideas:**

- **N-Plan Competition** -- spawn N plan-mode subagents in parallel, compare
  proposals, synthesize the best approach, then implement. Plan mode is read-only
  so this is cheap.
- State file copying into worktrees for immediate buildability.
- Two modes: `implement` (sandboxed, can write) and `plan` (read-only).

**Comparison to Ridgeline:** Simpler scope -- single-task isolation vs.
multi-phase pipeline. The N-Plan Competition pattern could improve Ridgeline's
planning phase quality.

### Permission and Security Tools

#### Sculpture

**Repo:** `Prajhan26/sculpture-plugin` (0 stars, Python)

Removes AI capabilities entirely rather than restricting them. Three enforcement
layers: tool stripping (pre-request), hallucination interception (post-response),
context shaping (system prompt says capability does not exist).

**Notable ideas:**

- Capability removal over restriction -- provably absent capabilities are easier
  to audit than behavioral guardrails.
- Token savings from removing unused tool definitions (~100-300 tokens per tool
  per request).
- Pre-built role templates (customer-support, code-reviewer, content-writer).

**Comparison to Ridgeline:** Ridgeline already uses `--allowedTools` for tool
restriction. Sculpture's approach of also shaping the system prompt to deny
knowledge of removed tools is an additional hardening layer.

#### Veto

**Repo:** `damhau/veto-claude-plugin` (1 star, Python)

Centralized permission gateway. Every tool call is sent to a Veto server for
evaluation against whitelist/blacklist rules with optional AI-powered risk
scoring. Returns allow/deny/ask decisions.

**Notable ideas:**

- Server-side rule evaluation for centralized team policy management.
- Three outcomes: allow, deny, or ask (prompt user).
- Fail-open/fail-closed policy configuration.

**Comparison to Ridgeline:** Relevant for enterprise Ridgeline deployments where
consistent policy enforcement across teams is needed. Overkill for single-user
use.

#### claudit-sec

**Repo:** `HarmonicSecurity/claudit-sec` (105 stars, Shell)

Read-only security audit tool for Claude Desktop/Code on macOS. Single command
gives visibility into MCP servers, extensions, plugins, permissions, runtime
state, and cookies. Outputs to terminal, HTML, or JSON (SIEM-ready).

**Notable ideas:**

- Maps the entire attack surface of Claude installations.
- Sensitive data redaction in all output formats.
- Multi-user audit when run as root.

**Comparison to Ridgeline:** Complementary. Could verify that the Claude Code
environment is properly configured before Ridgeline runs a build.

### Monitoring and Observability

#### AgentMonitor

**Repo:** `Ericonaldo/AgentMonitor` (17 stars, TypeScript/React)

Web dashboard for running and monitoring multiple Claude Code agents. Real-time
streaming, task pipelines, session resume, git worktree isolation, and remote
access via relay server. Notifications via Email/WhatsApp/Slack/Feishu.

**Notable ideas:**

- External agent discovery -- auto-detects Claude Code processes started outside
  the dashboard.
- Cloneable templates for agent provisioning.
- PTY web terminal for each agent's working directory.
- Relay mode for remote access without opening inbound ports.

**Comparison to Ridgeline:** Solves the observability gap that orchestrators
create. When Ridgeline runs parallel agents in worktrees, visibility into what
each is doing becomes important. Could complement Ridgeline's CLI output.

---

## Other Interesting Ideas

Patterns from community projects that could benefit Ridgeline beyond sandboxing.

### Deterministic quality gating before LLM review

**Source:** quorum

Measure type safety, test coverage, build health, complexity, security, and
dependencies as numeric scores. Set thresholds for auto-reject (below 0.3),
self-correct (0.3-0.7), and proceed (above 0.7). Only invoke expensive LLM
review when deterministic checks cannot decide. The 13-factor conditional
trigger system decides audit depth per change.

**Application:** Ridgeline's reviewer agent could be skipped for changes that
pass all deterministic checks. This would reduce cost and latency for simple
phases.

### Mandatory context compression between phases

**Source:** fellowship

Long-running sessions degrade -- research noise pollutes implementation quality.
Compressing context between every phase keeps the model in its "reasoning sweet
spot."

**Application:** Ridgeline already uses separate CLI invocations per phase, which
provides a natural context boundary. But within a phase (e.g., a long build
session with retries), mid-session compression could help.

### N-Plan Competition

**Source:** spinoff

Spawn 2-3 plan agents in parallel (read-only, cheap), compare their proposals,
synthesize the best approach, then proceed with a single implementation. Produces
better designs than single-pass planning.

**Application:** Ridgeline's plan phase could optionally run multiple planners
and merge their insights before handing off to the builder.

### Cross-agent knowledge sharing

**Source:** fellowship (bulletin board)

Parallel agents post discoveries to a shared bulletin during research and
implementation. Other agents can read the board to avoid redundant work or
benefit from findings.

**Application:** When Ridgeline runs parallel build phases, a shared context
file could let agents coordinate. Relevant for large builds where modules have
implicit dependencies.

### Failure memory / quest autopsy

**Source:** fellowship, mach10

When a build fails, record what went wrong in a persistent store. Future builds
in the same project can read past failures and avoid known pitfalls.

**Application:** Ridgeline could maintain a `.ridgeline/failures.json` or
similar file that accumulates lessons from failed builds, injected into agent
context for subsequent attempts.

### Fresh session per step with external persistence

**Source:** mach10

Each pipeline step gets a fresh Claude session with full context depth. State
transfers between steps via GitHub issues, PR comments, or disk files -- not
model memory.

**Application:** Validates Ridgeline's existing architecture of separate CLI
invocations per phase. Ridgeline's phase output files (`plan.md`,
`review-*.md`) already serve as the persistence layer.

### Token-efficient precision tooling

**Source:** GoodVibes

Replace broad file reads with precision reads (only the lines you need). Batch
operations to reduce round-trips. Cache file state via SHA256 to avoid re-reading
unchanged files.

**Application:** At scale, Ridgeline builds consume significant tokens.
Precision tooling in agent system prompts (e.g., "read only the function you
need to modify, not the entire file") could reduce costs.

### Structural enforcement over prompt enforcement

**Source:** fellowship, quorum, sculpture

When you need an agent to not do something, blocking the capability is more
reliable than instructing against it. Fellowship measured 33% -> 95%+ compliance
by switching from prompt-based to structural gates.

**Application:** Ridgeline already uses `--allowedTools` (structural). The
remaining prompt-based restrictions (e.g., "do not modify files outside the
repo") should be converted to structural enforcement where possible -- which is
exactly what OS-level sandboxing provides.

---

## Implementation Status

The layered defense strategy has been implemented:

1. **OS-level sandbox** (Greywall/bwrap) -- auto-detected, on by default,
   `--unsafe` to opt out. Greywall provides domain-level network allowlisting;
   bwrap provides binary network blocking. Provider interface in
   `src/engine/claude/sandbox.ts` with implementations in `sandbox.bwrap.ts`
   and `sandbox.greywall.ts`.

2. **Network allowlist** -- sensible defaults (npm, pypi, crates.io, github,
   etc.) with user overrides via `.ridgeline/settings.json`. User list replaces
   defaults entirely. Loaded by `src/store/settings.ts`.

3. **Git worktrees** -- each build runs in `.ridgeline/worktrees/<build-name>`
   on a `ridgeline/wip/<build-name>` branch. Completed phases are fast-forward
   merged back to the user's branch. Failed worktrees left for inspection.
   `ridgeline clean` removes stale worktrees. Module at
   `src/engine/worktree.ts`.

4. **PreToolUse network guard hook** -- blocks `curl`, `wget`, `ssh`, etc.
   while allowing package managers. Only active in `--unsafe` mode (no
   sandbox). Shipped at `src/agents/core/hooks/network-guard.md`.

5. **MCP filtering** -- not yet implemented. Could be a future addition for
   controlled external access (docs, packages) via a filtered MCP server.

See `docs/superpowers/specs/2026-04-03-sandbox-worktree-design.md` for the
full design spec and `docs/superpowers/plans/2026-04-03-sandbox-worktree-plan.md`
for the implementation plan.
