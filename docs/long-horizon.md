# Long-Horizon Execution

## The Problem

Context windows are finite. Even at one million tokens, a large project's
codebase, task description, tool outputs, and accumulated reasoning can exceed
what fits in a single agent session. And well before the hard limit, quality
degrades -- earlier decisions get pushed out of active context, the agent
contradicts itself, and coherence breaks down.

This is the fundamental tension of AI-driven software execution: the work is
large, but the agent's memory is bounded.

A single long-running session accumulates noise. Every file read, every bash
output, every reasoning step consumes context budget. By the time the agent
reaches the later stages of a complex project, it may have forgotten the
architectural decisions it made at the start. The result is drift --
inconsistent patterns, duplicated work, contradictory implementations.

## Phase Decomposition

Ridgeline's answer is decomposition. The planner breaks a project into
sequential phases, each sized to roughly 50% of the builder model's context
window. This leaves headroom for the builder to explore the codebase, run
tools, reason about implementation, and handle retries -- all within a
comfortable budget.

Each phase gets a **fresh context window**. The builder starts clean, with only
what it needs:

- The phase spec (goal, context, acceptance criteria)
- Constraints and taste files
- The accumulated handoff from prior phases
- Feedback from the reviewer (on retry only)

No stale tool outputs. No reasoning artifacts from three phases ago. No
gradually degrading coherence. Each phase is a focused sprint with clear
boundaries.

The planner handles the decomposition, considering both the project scope and
the target model's capability. Opus (approximately 1M tokens) gets larger, more
ambitious phases. Sonnet (approximately 200K) gets smaller, more focused ones.
Phases are ordered so dependencies flow forward -- phase N can assume everything
from phases 1 through N-1 is complete.

## Why Sequential, Not Parallel

Phases run one at a time. This is a deliberate choice, not a limitation.

Dependencies flow forward -- phase N assumes everything from phases 1 through N-1
is complete. This ordering is inherent to the work: you cannot build an API on a
database schema that does not exist yet. Parallelizing phases would require a
dependency DAG, and the decomposition granularity that makes phases useful (roughly
50% of context) means most phases have real dependencies on their predecessors.

Sequential execution also makes debugging straightforward. When a phase fails, the
cause is local: something in this phase or its inputs. There is no need to reason
about race conditions, conflicting file edits, or ordering ambiguities between
concurrent agents. The git history is linear, the state transitions are
deterministic, and the trajectory log reads in order.

The cost is wall-clock time. A five-phase build takes five sequential builder
invocations plus their reviews. For projects where phases are genuinely independent
(e.g., separate microservices from a shared spec), this is slower than necessary.
But for most projects, the dependencies are real, and the simplicity of sequential
execution is worth the time.

## The Handoff Mechanism

Fresh context solves the noise problem, but creates a new one: how does the
builder for phase 3 know what happened in phases 1 and 2?

The answer is `handoff.md` -- an append-only file that accumulates context
across phases. After completing each phase, the builder appends a structured
section:

```markdown
## Phase 2: Core API

### What was built
- src/routes/users.ts — CRUD endpoints for user management
- src/db/schema.ts — Drizzle ORM schema with users table
- src/middleware/auth.ts — JWT verification middleware

### Decisions
- Used Drizzle ORM instead of raw SQL for type safety
- PUT endpoints do full replacement, not partial update

### Deviations
- Added a health check endpoint not in the spec (needed for acceptance criteria verification)

### Notes for next phase
- Auth middleware expects JWT in Authorization header with Bearer prefix
- Database migrations must run before the API starts
```

The next builder reads the full accumulated handoff before doing anything else.
This gives it a compressed, decision-focused summary of the project's history
-- not the raw implementation details, but the architectural context needed to
continue coherently.

The handoff format is prescribed (what was built, decisions, deviations, notes
for next phase) to ensure consistency across phases. Builders know what to
write because the format is part of their system prompt.

## Git Checkpoints

Handoff carries the intellectual context. Git carries the code context.

Before each phase begins, the harness commits any dirty working tree and
creates a checkpoint tag (`ridgeline/checkpoint/<build>/<phase>`). This serves
multiple purposes:

- **Rollback.** If a phase fails after exhausting retries, the user can reset
  to the checkpoint: `git reset --hard <checkpoint-tag>`.
- **Review scope.** The reviewer receives the git diff from checkpoint to HEAD,
  showing exactly what the builder changed -- nothing more, nothing less.
- **Resumability.** On re-running `ridgeline build`, the harness checks for
  completion tags and picks up from the last successful phase.

On phase success, a completion tag is created
(`ridgeline/phase/<build>/<phase>`). When the full build completes, all
ridgeline tags are cleaned up.

## The Builder Loop

A single phase rarely fits in a single Claude invocation. The orchestrator
runs a **builder loop** per phase: each iteration is a fresh-context Claude
call that either declares the phase ready for review, asks for more work,
or hits a halt condition.

The builder's final non-blank line is one of two markers:

- `READY_FOR_REVIEW` — every acceptance criterion is met; the reviewer runs
  next.
- `MORE_WORK_NEEDED: <reason>` — valid work was completed but unfinished
  items remain. The builder appends a continuation entry to
  `phases/<id>.builder-progress.md` describing what's done, what's left,
  and any gotchas. The orchestrator spawns a fresh-context continuation
  that reads the progress file and picks up.

Each invocation gets a budget computed from the model's context window
minus the input prompt size. The soft target tells the builder "wind down
around here at a natural breakpoint"; the hard target is the
truncation-risk ceiling. Default fractions are 70% (soft) and 85% (hard)
of available output budget; `phaseTokenLimit` from settings.json caps the
soft target further. The context window is per-model (200K default; bump
to 1M for the long-context Sonnet variant in `settings.contextWindows`).

Halt conditions per loop, in priority order:

1. Cumulative phase cost exceeds 5×`phaseBudgetLimit` (skipped when the
   user has set `phaseBudgetLimit: "unlimited"`).
2. Total build cost exceeds `--max-budget-usd`.
3. Diff hash unchanged between consecutive invocations (no progress —
   1 strike, immediate halt).
4. Continuation count reaches `maxContinuations` (default 5).

A phase that halts is failed; one that emits `READY_FOR_REVIEW` proceeds
to the reviewer. Per-phase invocation history is persisted to `state.json`
under `builderInvocations[]`.

## The Retry Loop

The reviewer is adversarial by design. Its job is to find problems, not
validate success. When it rejects a phase, the harness generates a feedback
file from the structured verdict -- a markdown document listing failed
criteria, blocking issues with evidence, and the required end state for each
issue.

The builder retries with the same phase spec plus this feedback. Critically,
the retry is a **fresh Claude invocation** -- a clean context window with
targeted information about what to fix. The builder reads the feedback, orients
on the current codebase state, and addresses the specific issues.

Retries are capped (default: 2, configurable via `--max-retries`). If
exhausted, the build halts with instructions for manual recovery. This prevents
infinite loops where the builder and reviewer disagree about how to satisfy a
criterion.

## Stop Controls

Two ways to pause a long-running build cleanly without losing state:

**`--require-phase-approval`** — between phases (or wave boundaries) the
orchestrator pauses and asks `Continue to phase N? [Y/n/q]`. Press Enter
to proceed, `n` or `q` to exit. State is preserved; resume with
`ridgeline build <name>`.

**Graceful-stop keystroke (`q`)** — while a build is running in a TTY,
press `q` (or `Ctrl-G`) to request a graceful stop. The current phase
finishes naturally — including any in-flight builder loop continuations —
and the orchestrator exits 0 at the next phase boundary. A second press
within 5 seconds escalates to a regular `SIGINT` for "stop NOW."

Both paths converge on the same `state.json`-based resume mechanism — the
next `ridgeline build <name>` invocation skips completed phases and picks
up at the first pending one.

## Tradeoffs

Phase decomposition is not free. There are real costs to this approach:

**Information loss at boundaries.** Handoff.md captures the essentials, but
subtle context -- why a particular pattern was chosen over alternatives, edge
cases that were considered and rejected, nuances of the existing codebase --
can be lost between phases. This is acceptable because each phase spec is
self-contained with its own acceptance criteria. The builder doesn't need to
know *why* phase 1 chose a particular approach, only *what* was built and what
conventions to follow.

**Phase ordering constraints.** Dependencies must flow forward. Phase 3 cannot
depend on something that phase 4 will build. Circular dependencies between
phases are not supported. The planner handles this, but poorly scoped specs can
make clean decomposition difficult.

**Per-phase startup overhead.** Each phase has startup cost: loading context,
exploring the codebase, understanding the current state. Fewer, larger phases
reduce this overhead. The planner balances phase count against the context
budget -- too many small phases waste time on orientation; too few large phases
risk exceeding the context window.

**Review overhead.** Every phase includes a reviewer invocation, even if the
builder got it right on the first pass. This is the cost of adversarial
verification. It adds latency and spend, but catches problems that would
compound in later phases.

**Context isolation vs. shared state.** Fresh context windows are the core
mechanism, but they create a tension. The builder for phase 4 cannot see the
reasoning that shaped phase 2's implementation -- only the compressed summary in
handoff.md and the code itself. Subtle context gets lost: why a particular pattern
was chosen over alternatives, edge cases that were considered and rejected, implicit
conventions that emerged during earlier phases.

This is manageable when specs are well-written and handoff notes are thorough. It
breaks down when the codebase has deep implicit conventions that no one thinks to
document -- naming patterns that evolved organically, architectural decisions that
are obvious to a human reading the full history but invisible in a summary. The
mitigation is explicit: write constraints for conventions that matter, write
detailed acceptance criteria, and trust that the builder will explore the codebase
before making decisions. The handoff mechanism does not need to carry everything --
it needs to carry enough for the builder to orient and discover the rest.

## Benefits

The tradeoffs buy real advantages:

**Fresh context prevents accumulated confusion.** Each phase starts clean. No
stale reasoning, no forgotten decisions, no gradual coherence decay. The
builder's attention is focused entirely on the current phase's scope.

**Natural audit trail.** State.json, trajectory.jsonl, handoff.md, and git
tags together tell the complete story of a build: what was planned, what was
built, what was reviewed, what failed, what was retried. Every decision is
recorded.

**Resumability.** Builds can be interrupted and resumed. Network outages, cost
limits, manual intervention -- the harness picks up from the last checkpoint
without re-executing completed work.[^2]

**Cost isolation.** Budget tracking is per-phase, per-role, per-attempt. If a
phase is expensive, you can see exactly why. Cost limits halt the build at a
defined threshold rather than letting it run unbounded.

**Failure containment.** A failed phase doesn't corrupt the rest of the
project. The checkpoint tag preserves the known-good state.[^3] The builder can
retry with targeted feedback or the user can intervene manually.

## Trajectory Translation

Ridgeline's trajectory log (`.ridgeline/builds/<name>/trajectory.jsonl`) is
the single chronological record of everything that happened during a build:
plan starts, build/review starts and completes, phase advances, phase
failures, budget events. The substrate underneath the harness is the
`fascicle` library, which emits its own internal `TrajectoryEvent` shape
(span starts, span ends, custom emits) as flows run.

These two shapes do not match. Fascicle's events are organised around its
composition primitives (every `compose(name, ...)`, `model_call`,
`retry`, `parallel` etc. emits span-level entries), and span-stamped
internal mechanics are not what fascicle-viewer or ridgeline's external
.jsonl consumers expect. Ridgeline therefore **translates** fascicle's
events into its existing on-disk shape rather than writing them
verbatim:

- `src/engine/adapters/ridgeline_trajectory_logger.ts` recognises
  ridgeline-shaped events (`{ kind: "ridgeline_trajectory", entry }`)
  and appends the inner `entry` to `trajectory.jsonl` using
  `appendTrajectoryEntry()` from `src/stores/trajectory.ts`.
- `src/engine/adapters/ridgeline_budget_subscriber.ts` recognises
  ridgeline-shaped cost events
  (`{ kind: "ridgeline_cost", id, entry }`) and appends them to
  `budget.json`.
- Other fascicle event kinds (`span_start`, `span_end`, raw
  `emit`) are intentionally dropped on the floor at the .jsonl
  boundary -- they remain visible to in-process subscribers but never
  hit disk in fascicle's native shape.

The decision to translate rather than emit verbatim was deliberate:
preserving the existing on-disk schema means `fascicle-viewer`,
external dashboards, and anything else that read pre-migration
`trajectory.jsonl` files keep working without modification.
New ridgeline-emitted event types use camelCase identifiers (the
ridgeline-side naming convention); fascicle-emitted kinds keep
their snake_case names exactly as fascicle emits them, on the rare
occasions the in-process stream is consumed directly.

A small consequence: when adding a new diagnostic event in
`src/engine/{flows,atoms,composites,adapters}/`, prefer
`ctx.trajectory.emit({ kind: "ridgeline_trajectory", entry: ... })`
over a direct `console.error` or `process.stderr.write`. The former
flows through the adapter into `trajectory.jsonl`; the latter clutters
the terminal and isn't visible to downstream readers.

## Industry Trends

The patterns ridgeline implements are not unique -- they are emerging across the
AI tooling ecosystem:

**Agent loops** (build, verify, retry) are becoming the standard execution
model for AI coding tools. Single-shot generation is giving way to iterative
refinement with automated verification.

**Multi-turn execution** with tool use is now baseline. Models read files, run
commands, inspect outputs, and adjust -- not just generate code in isolation.

**Context management strategies** are an active area of development. As
projects grow beyond single-context scale, every tool needs an approach:
retrieval-augmented generation, sliding windows, summarization, decomposition.
Phase-based decomposition with structured handoff is one of the cleaner
solutions.

**Separation of concerns** in agent systems (planner vs. builder vs. reviewer)
mirrors established software engineering practices.[^1] The industry is learning
that monolithic agents degrade under complexity, just as monolithic software
does.

## Comparison with Alternatives

**Single massive context.** Works for small projects. As the project grows,
quality degrades -- earlier context gets displaced by tool outputs and
reasoning. No checkpoints, no retry isolation, no resumability. The approach
that works for a 200-line script does not scale to a 20,000-line project.

**RAG-based context management.** Retrieves relevant code snippets on demand,
keeping the context window focused. Good for exploration and question-answering,
but does not provide the structured decomposition needed for multi-step
implementation. The agent still needs a plan for what to build and in what
order.

**Manual decomposition.** The user breaks work into tasks and runs an agent on
each. This works but puts the decomposition burden on the user, loses the
automated review/retry loop, and doesn't provide structured context bridging
between tasks.

**Ridgeline's approach.** Combines automated decomposition (planner), fresh
contexts (phases), structured context bridging (handoff), adversarial
verification (reviewer), and recovery (git checkpoints). Each piece is simple
and well-understood. Together they enable projects that exceed any single
context window while maintaining coherence, auditability, and recoverability.

[^1]: **Further reading:** [Building Managed Agents](https://www.anthropic.com/engineering/managed-agents) — Anthropic's engineering guidance on coordinating multi-agent systems with clear role separation and state handoff between agents.
[^2]: **Further reading:** [Workflow Execution — Temporal](https://docs.temporal.io/workflow-execution) — Temporal's durable execution model, where workflow state persists across failures and restarts, enabling the same checkpoint-and-resume pattern Ridgeline uses.
[^3]: **Further reading:** [Multi-Agent Design Patterns](https://www.infoq.com/news/2026/01/multi-agent-design-patterns/) — Google's multi-agent patterns paper discusses failure isolation as a key benefit of decomposing agent work into discrete, recoverable units.
