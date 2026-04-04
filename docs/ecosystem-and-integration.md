# Ecosystem Position and Future Integration

Ridgeline occupies a specific niche in the AI coding tool landscape: autonomous,
multi-phase software execution. This document explains where that niche sits
relative to the broader ecosystem of AI coding agents and how Ridgeline might
integrate with other tools rather than compete with them.

## The Autonomy Spectrum

AI coding tools fall along a spectrum from fully interactive to fully autonomous:

```text
Interactive                                              Autonomous
    |                                                        |
    |  Cursor   Claude Code   Pi      ???      Ridgeline     |
    |  Copilot  OpenCode      Aider                          |
    |                                                        |
    human steers every turn              human provides spec,
    reviews every diff                   walks away
```

Most tools cluster on the interactive end. The developer sits in the loop,
prompting, reviewing diffs, steering decisions turn by turn. These tools
optimize for that experience -- transparent diffs, fast responses, broad model
support, tight editor integration.

Ridgeline sits on the other end. It takes a spec, decomposes it into phases,
and orchestrates a planner/builder/reviewer pipeline that runs without human
intervention until it either finishes or gets stuck. The human's job is to
write a good spec and review the result, not to babysit each step.

The gap in between -- the `???` -- is where the interesting integration
questions live.

## What Ridgeline Does Not Do

Ridgeline is not an interactive coding agent. It does not provide:

- A terminal UI for conversational coding sessions
- Multi-provider model support (it wraps the Claude CLI)
- An extension or plugin ecosystem for interactive workflows
- Editor integration or IDE features
- Real-time diff streaming for human review

These are deliberate omissions. Building any of them would duplicate work that
other tools already do well, and would dilute focus from the hard problem
Ridgeline actually targets: long-horizon autonomous execution with quality
gates.

## What Other Tools Do Not Do

Interactive agents -- even excellent ones -- do not solve phased autonomous
execution. Specifically, they lack:

- **Spec decomposition.** Breaking a large project into context-window-sized
  phases with dependency ordering and handoff contracts.
- **Automated review gates.** A separate agent that verifies acceptance criteria
  against diffs, produces structured verdicts, and triggers retries with
  targeted feedback.
- **Resumable execution.** Git-based checkpointing that allows a failed build to
  resume from the last successful phase rather than starting over.
- **Budget enforcement.** Hard cost limits and per-invocation tracking across a
  pipeline that may run dozens of agent sessions.
- **Context bridging.** An append-only handoff mechanism that carries decisions,
  deviations, and architectural context from one phase to the next without
  consuming the entire context window.

These are the problems that emerge when you try to move from "human in the
loop" to "human writes the spec." Single-session agents hit context window
limits, lose coherence across large tasks, and have no mechanism for structured
self-correction. Ridgeline exists to solve exactly that.

## Pi: A Case Study in Complementary Design

[Pi](https://github.com/badlogic/pi-mono) is Mario Zechner's open-source
minimal coding agent. It is worth examining in detail because it validates many
of Ridgeline's instincts while targeting a completely different problem.

### Where Pi and Ridgeline Agree

- **Minimal system prompts.** Pi uses ~200 tokens. Ridgeline's agent prompts are
  focused and scoped. Both reject the trend of 10K+ token system prompts
  stuffed with safety instructions and tool descriptions.
- **File-based planning.** Pi uses PLAN.md and TODO.md instead of ephemeral plan
  modes. Ridgeline uses spec.md, constraints.md, and numbered phase files.
  Both treat plans as durable artifacts, not transient UI state.
- **Bash as the universal tool.** Pi ships four tools: read, write, edit, bash.
  Ridgeline's builder agent uses the same core set. Both trust that bash
  composes better than purpose-built tools.
- **Observability over magic.** Pi surfaces every tool call and token count.
  Ridgeline logs every invocation to trajectory.jsonl with costs, durations,
  and token usage. Both prioritize auditability.
- **Skepticism toward MCP.** Pi avoids MCP entirely (7-14K token overhead per
  server). Ridgeline uses CLI tools and scoped permissions instead. Both
  prefer paying token costs on-demand rather than upfront.

### Where Pi and Ridgeline Diverge

| Dimension | Pi | Ridgeline |
|---|---|---|
| **Session model** | Interactive, human-in-the-loop | Autonomous, multi-phase pipeline |
| **Planning** | Human writes PLAN.md | Planner agent decomposes spec |
| **Review** | Human reviews diffs | Reviewer agent with structured verdicts |
| **Recovery** | Start a new session | Resume from git checkpoint |
| **Model support** | 20+ providers, 324 models | Claude CLI (Anthropic models) |
| **Community** | 11.5K GitHub stars, 3M npm downloads/month | In development |

These are not competing visions. They are complementary layers.

## The Integration Thesis: Ridgeline Orchestrating Pi

Today, Ridgeline spawns Claude CLI sessions for each agent invocation. The
builder agent is a Claude CLI process with scoped tool permissions, a system
prompt, and a user prompt piped via stdin. This works, but it locks Ridgeline
to a single model provider and inherits Claude CLI's overhead.

Pi offers an alternative execution engine. Its architecture supports exactly
the interface Ridgeline needs:

- **`--mode json`** provides JSONL event streaming, giving Ridgeline structured
  output from each session without parsing terminal UI.
- **`--mode rpc`** exposes 26+ commands over a JSON protocol, enabling
  programmatic session control from an external orchestrator.
- **`createAgentSession()` SDK** provides full programmatic access for
  in-process integration.
- **Multi-model support** means Ridgeline could assign different models to
  different roles: a fast, cheap model for planning, a capable model for
  building, a reasoning model for reviewing.
- **Custom tools via `pi.registerTool()`** would allow Ridgeline to inject
  phase-specific tools (handoff writers, checkpoint triggers) into the builder
  session without modifying Pi itself.

The integration would look something like:

```text
Ridgeline (orchestrator)
  |
  |-- Planner phase:  pi --mode json --model gemini-2.5-pro < phase-prompt
  |-- Builder phase:  pi --mode json --model claude-opus   < build-prompt
  |-- Reviewer phase: pi --mode json --model claude-opus   < review-prompt
  |
  State management, checkpointing, retry logic, budget tracking
  all remain in Ridgeline
```

Ridgeline keeps what it is good at -- pipeline orchestration, state management,
quality gates, cost control -- and delegates interactive execution to a tool
purpose-built for it. Pi keeps what it is good at -- minimal prompts,
multi-model flexibility, transparent tool execution -- and gains access to
structured, autonomous workflows it explicitly does not build.

### What This Enables

- **Model specialization per role.** Use a fast model for planning, a capable
  model for building, a reasoning model for reviewing. Switch models without
  changing Ridgeline's orchestration logic.
- **Provider resilience.** If one provider is down or rate-limited, fall back to
  another without pipeline changes.
- **Cost optimization.** Route simple phases to cheaper models and reserve
  expensive models for complex phases. Budget tracking already exists in
  Ridgeline; multi-model routing makes it actionable.
- **Community leverage.** Pi's extension ecosystem (tools, themes, providers)
  becomes available to Ridgeline builds without Ridgeline maintaining any of
  it.

## Other Potential Integrations

The same principle -- Ridgeline orchestrates, other tools execute -- extends
beyond Pi:

- **Claude Code** remains a viable executor for teams already using it. Its
  sub-agent and teams features could handle builder phases that require
  parallel work.
- **Aider** could serve as a lightweight executor for small phases where a full
  agent session is overkill.
- **Local models via Ollama** could handle planning or simple scaffolding phases
  where cost matters more than capability.

The key architectural insight is that Ridgeline's value lives in the
orchestration layer, not the execution layer. The executor is a pluggable
dependency.

## Design Principles for Integration

Any executor integration should follow these constraints:

1. **Structured output.** The executor must return machine-parseable results --
   not terminal UI output. JSON or JSONL streaming is the minimum bar.
2. **Scoped permissions.** The orchestrator must be able to restrict what the
   executor can do per phase. A reviewer should not be able to write files.
3. **Cost reporting.** The executor must report token usage and cost per session
   so Ridgeline can enforce budget limits.
4. **Stateless sessions.** Each executor invocation should be independent.
   Cross-phase state lives in Ridgeline (handoff.md, state.json), not in the
   executor's session history.
5. **Timeout and cancellation.** The orchestrator must be able to kill a hung
   executor session. Long-running builds need hard time limits.

Pi satisfies all five today through its JSON mode, SDK, and per-session cost
tracking. Claude CLI satisfies them through its stream-json output format and
allowedTools flag. Any future executor would need to meet the same bar.

## Summary

Ridgeline is not trying to be the best interactive coding agent. It is trying
to solve the problem that interactive agents cannot: autonomous, multi-phase
software execution with structured quality gates and resumable state. The
ecosystem already has excellent interactive tools. Ridgeline's future lies in
orchestrating them, not replacing them.

## References

- [Pi Mono (GitHub)](https://github.com/badlogic/pi-mono) -- Pi's monorepo
  with pi-ai, pi-agent-core, pi-tui, and pi-coding-agent packages.
- [What I learned building an opinionated and minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
  -- Zechner's detailed writeup on Pi's design philosophy and lessons learned.
- [Pi vs Claude Code Comparison](https://github.com/disler/pi-vs-claude-code/blob/main/COMPARISON.md)
  -- Community-maintained feature comparison.
- [I ditched Claude Code and OpenCode for Pi (XDA)](https://www.xda-developers.com/replaced-claude-code-and-opencode-with-pi/)
  -- User perspective on switching from Claude Code to Pi.
- [Pi: The Minimal Agent Within OpenClaw](https://lucumr.pocoo.org/2026/1/31/pi/)
  -- Armin Ronacher's analysis of Pi's role in the OpenClaw ecosystem.
- [Ollama Launches Pi](https://www.sci-tech-today.com/news/ollama-pi-coding-agent-launch-openclaw-customization/)
  -- Ollama's native Pi integration announcement.
