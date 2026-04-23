# Infrastructure Audit

An assessment of ridgeline's architecture against the six-layer AI agent
infrastructure framework: compute/sandboxing, identity/communication,
memory/state, tool access/integration, provisioning/billing, and
orchestration/coordination.

This document covers the current stack, the planned model-agnostic abstraction,
and the strategic position relative to platform-native orchestration (e.g.,
Anthropic's Mythos).

## Current Stack

| Layer | What ridgeline uses | Durability | Risk | Notes |
|---|---|---|---|---|
| Compute / sandboxing | Local Node.js + Claude CLI subprocesses. Git worktrees for build isolation. Greywall (macOS) / bwrap (Linux) for network and filesystem sandboxing. | High | Low | Correct for a local CLI tool. Worktrees are a strong isolation primitive. Sandboxing is optional but well-layered. |
| Identity / communication | Implicit via Claude CLI OAuth. No agent identity. File-based handoffs (handoff.md, feedback.md). | N/A | Low | Agents are prompt templates, not entities. No identity needed at current scope. Only becomes a problem if ridgeline goes distributed. |
| Memory / state | File-based: state.json, budget.json, trajectory.jsonl, markdown artifacts. Git tags as transactional checkpoints. No database. | High | Low | Git-as-transaction-log is durable and inspectable. Strongest choice for single-user local execution. |
| Tool access / integration | Claude CLI native tools (Read, Write, Bash, Glob, Grep, Agent). Per-role permission matrix enforced at CLI level. No MCP. | Medium | High | Hard-coupled to Claude CLI's tool surface and output format. The permission matrix is well-designed, but ridgeline owns none of the execution substrate. |
| Provisioning / billing | Per-invocation cost tracking (tokens, USD, duration). --max-budget-usd cap. Observability only, no payment processing. | High | Low | Budget caps are a meaningful control. Right scope for a CLI tool. |
| Orchestration / coordination | Sequential pipeline with ensemble parallelism (3 specialists into synthesizer). Retry loops with reviewer feedback. Git-tag-verified resumption. Stall detection and timeout enforcement. | High | Low | This is the product. Well-structured for the scope. |

### Current Shim Risks

**Claude CLI as execution substrate (tool access layer).** The entire system
shells out to `claude` and parses its streaming JSON output. Every agent
invocation, tool permission, timeout, and sandbox integration flows through this
dependency. Anthropic treats the CLI as a developer tool, not a stable API
surface -- output format, flag semantics, and tool names can change between
releases.

- Why it's a shim: the durable primitive is the Claude API, not the CLI wrapper.
- Migration cost: high. Moving to direct API calls means rebuilding streaming,
  tool dispatch, sub-agent invocation, and sandbox integration.
- Recommendation: keep it, but insulate. The existing `claude.exec.ts` and
  `stream.parse.ts` are already a decent abstraction boundary. Harden that seam:
  version-pin the CLI, add integration tests against CLI output format, and treat
  any CLI upgrade as a breaking-change candidate.

**Greywall / bwrap as sandbox providers (compute layer).** Third-party tools
with small user bases. Greywall is macOS-specific; bwrap is Linux-only. The
sandbox abstraction already supports swappable providers.

- Migration cost: low. Adding a new provider is straightforward.
- Recommendation: keep for now. Swap when a more durable sandbox primitive
  emerges.

**Git tags as phase-completion proof (memory/state layer).** Pragmatic and
correct for single-user local execution. Tags can be manually deleted, and
concurrent builds on the same repo could collide.

- Migration cost: low if it ever matters.
- Recommendation: keep.

### Current Build / Rent / Watch

| Layer | Recommendation | Rationale |
|---|---|---|
| Compute / sandboxing | Rent | Local execution + worktrees is the right call. Swap sandbox providers as the market matures. |
| Identity / communication | Watch | No identity layer needed yet. Revisit if ridgeline goes distributed. |
| Memory / state | Build | File-based state + git checkpoints is a competitive advantage. Inspectable, diffable, recoverable. |
| Tool access / integration | Watch | Rented via Claude CLI. Biggest single-vendor risk. Monitor Anthropic's SDK roadmap. |
| Provisioning / billing | Rent | Budget tracking is sufficient. If productized, add metering on top. |
| Orchestration / coordination | Build | This is the product. The pipeline, retry logic, ensemble coordination, and resumption model are the moat. |

## Model-Agnostic Abstraction (Planned)

The next major release abstracts away specific model calls so that Claude becomes
one of many configuration options. Agents can be defined with multi-model
setups where different local or remote models handle different parts of the
pipeline based on their specializations.

This converts ridgeline from a Claude CLI wrapper into a portable orchestration
harness. The risk profile changes substantially.

### Revised Stack

| Layer | Current | Planned | Durability | Risk |
|---|---|---|---|---|
| Compute / sandboxing | Claude CLI subprocesses + worktrees | Multi-backend subprocesses (local models, API providers) + worktrees | High | Medium |
| Identity / communication | Implicit via Claude CLI | Per-backend auth (API keys, local model paths, OAuth) | Medium | Medium |
| Memory / state | File-based + git tags | Unchanged | High | Low |
| Tool access / integration | Claude CLI native tools, permission matrix | Must build a tool dispatch layer | Low | High |
| Provisioning / billing | Token/USD tracking against Claude pricing | Multi-model cost attribution (different token prices, local models = wall-clock time not tokens) | Medium | Medium |
| Orchestration / coordination | Pipeline + ensemble + retry | Unchanged core, but now routing decisions per stage | High | Low |

### New Risks Introduced

**Tool dispatch without CLI.** Claude CLI currently handles tool definition,
permission enforcement, tool execution, result parsing, and sub-agent dispatch.
Dropping the CLI means owning all of this. Local models (Ollama, llama.cpp,
vLLM) have inconsistent or absent tool-use support.

- This is the N-times-M problem. N models times M tools. The Claude CLI
  collapsed this to 1-times-M.
- Recommendation: don't build a general tool-use framework. Ridgeline's tool
  surface is narrow and known: Read, Write, Edit, Bash, Glob, Grep, and Agent.
  Build adapters for these tools, not arbitrary tools. For models lacking native
  tool-use, use structured-output parsing (JSON mode) with a defined tool-call
  schema. For models with native tool-use (Claude API, OpenAI, Gemini), map to
  their native format.

**Sandbox model changes.** Greywall and bwrap hook into the Claude CLI's process
model. Local model inference may need GPU access, shared memory, or long-running
server processes that don't fit the same sandbox assumptions.

- Recommendation: split sandboxing into two concerns: model execution sandbox
  (how inference runs) and tool execution sandbox (how Bash/Write/etc. are
  constrained). The tool sandbox stays roughly the same. The model sandbox is new
  and may need to be per-backend.

**Cost model fragmentation.** Local model "cost" is wall-clock time and GPU
utilization, not token price. A unified metering model across heterogeneous
backends is needed.

### Revised Build / Rent / Watch

| Layer | Previous | Revised | Rationale |
|---|---|---|---|
| Compute / sandboxing | Rent | Build (partially) | Need a model-execution abstraction handling local GPU, remote API, and hybrid. |
| Identity / communication | Watch | Build (minimally) | Auth multiplexer across backends. Keep it thin: a config map of provider-to-credentials. |
| Memory / state | Build | Build | Unchanged. Gets more valuable as the model-agnostic anchor. |
| Tool access / integration | Watch | Build | Moves from rented via CLI to must-own. Single biggest work item in the release. |
| Provisioning / billing | Rent | Build | Cost attribution across heterogeneous backends requires a unified metering model. |
| Orchestration / coordination | Build | Build | Still the product. Now even more so. |

### Implementation Guidance

The highest-leverage design decision is the provider interface contract. If done
right -- thin, streaming, tool-aware, model-agnostic -- everything composes on
top of it. A provider should implement:
`invoke(prompt, tools, config) -> stream of events`. Don't leak model-specific
concepts (Claude's Agent tool, OpenAI's function calling schema) into the
orchestration layer.

Ship the abstraction with two backends first: Claude API (not CLI) and one local
model runtime (Ollama is the pragmatic choice). If the interface holds for those
two, it will hold for the rest.

## Platform Risk: Native Multi-Agent Orchestration

If Anthropic ships native multi-agent orchestration inside Claude Code (e.g.,
Mythos), several parts of ridgeline become redundant for Claude-only users:
agent spawning and lifecycle management, tool dispatch and permission matrices,
sandboxing, and basic build/review loops. This is roughly 60% of ridgeline's
current engineering surface.

### What platform orchestration cannot replace

**Model-agnostic pipelines.** Mythos is an Anthropic product. It will
orchestrate Claude models. It will not orchestrate a pipeline where phase 1
runs on a local fine-tuned Llama for fast cheap drafting, phase 2 runs on
Claude for rigorous spec synthesis, and phase 3 runs on Gemini because it
excels at a specific domain. Ridgeline post-abstraction becomes infrastructure
that sits below any single provider's orchestration layer.

**The pipeline methodology.** Shape, spec, plan, build, review is an opinionated
workflow, not a generic orchestration primitive. Platform tools will likely ship
lower-level building blocks (spawn agent, coordinate agents, share context).
They won't ship ridgeline's decomposition philosophy, ensemble-of-specialists
pattern, or phased handoff model.

**Inspectable, git-native state.** Ridgeline's state model is designed for
developer workflows -- inspectable, diffable, resumable via git. Platform
orchestration will almost certainly use opaque internal state. Developers who
need to see exactly what happened, rewind to a specific phase, and fork a build
from a checkpoint need what ridgeline provides.

**Offline and local-first execution.** Platform orchestration requires the
provider's infrastructure. Ridgeline with local models runs on a laptop with
no internet. This matters for air-gapped environments, cost-sensitive teams,
and privacy-constrained domains.

### Strategic Position

| Scenario | Ridgeline's position |
|---|---|
| Platform orchestration ships, ridgeline stays Claude-only | Dead. Platform absorbs it. |
| Platform orchestration ships, ridgeline is model-agnostic | Complementary. Claude becomes one backend. Users who want multi-model pipelines, local execution, or provider independence use ridgeline. |
| Platform orchestration doesn't ship or ships weak | Ridgeline wins either way with a broader market. |

The model-agnostic abstraction is not a nice-to-have. It is the survival move.
It converts ridgeline from "Claude CLI power tool" (vulnerable to platform
absorption) into "portable orchestration harness" (complementary to every
platform).
