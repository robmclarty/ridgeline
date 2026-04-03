# Future Models

Ridgeline is designed around patterns that are model-capability-aware but not
model-dependent. As models improve -- larger context windows, better reasoning,
more reliable tool use -- ridgeline gets better automatically. No architecture
changes required.

The system already adapts to model capability. The planner sizes phases based
on the target model's context window: opus (approximately 1M tokens) gets larger,
more ambitious phases; sonnet (approximately 200K tokens) gets smaller, more
focused ones. This same mechanism will scale to whatever comes next.

## Larger Context Windows

The planner sizes each phase to roughly 50% of the builder model's context
window, leaving headroom for tool outputs, codebase exploration, and reasoning.
When models ship with larger windows, the planner produces fewer phases for the
same project -- less decomposition overhead, fewer handoff transitions, more
coherent implementation within each phase.

Fewer phases also means less information loss at phase boundaries. The handoff
mechanism still provides value as a structured record of decisions, but with
larger windows the builder retains more direct context from its own work.

Even with very large context windows, the phase structure remains useful. It
provides natural checkpoints, cost isolation, and resumability -- properties of
the process, not workarounds for model limitations.

## Better Reasoning

More capable reasoning translates directly into fewer retries. When the builder
gets it right on the first pass, the reviewer confirms and the phase advances
without cycling through the feedback loop. This means lower cost per build and
faster wall-clock completion.

Better reasoning also improves the planner's output. More accurate scope
estimation, better dependency ordering between phases, and more testable
acceptance criteria. The downstream agents inherit this quality.

The review loop doesn't become unnecessary -- it becomes a safety net that
triggers less often. Even highly capable models make mistakes on complex
codebases. The adversarial reviewer catches problems that the builder's own
confidence masks.

## Better Tool Use

Models with stronger tool use explore codebases more effectively, write more
targeted tests, produce cleaner incremental commits, and generate more useful
handoff notes. Every step in the builder's process -- orient, implement, check,
commit, handoff -- benefits from better tool fluency.

Specialist sub-agents (checker, navigator, tester, depender) also improve.
Better tool use means the checker runs more thorough verification, the navigator
produces more useful codebase briefings, and the tester writes more
comprehensive acceptance tests.

## The Spec-Driven Approach is Model-Agnostic

Specs describe outcomes, not implementation. "Users can authenticate with email
and password" works regardless of which model implements it. The acceptance
criteria are the quality gate, and they are evaluated by running commands,
hitting endpoints, and checking outputs -- not by model-specific heuristics.

The reviewer's structured verdict (a JSON object with per-criterion pass/fail
results, evidence, and issues) is a protocol. It works with any model that can
produce structured output -- a capability that is now baseline across the
industry.

Constraints and taste files provide stable guardrails independent of model
capability. The language is TypeScript, the framework is Fastify, the check
command is `npm test` -- these don't change when the model changes.

## Industry Convergence

Ridgeline implements patterns that the broader AI tooling ecosystem is
converging on:

- **Agent loops.** Build, verify, retry. This cycle appears in every serious AI
  coding tool. Ridgeline implements it with explicit phase boundaries, git
  checkpoints, and structured feedback.

- **Tool use.** File read/write, shell execution, code search. These are now
  baseline capabilities. Ridgeline scopes them per agent role for safety.

- **Structured output.** JSON schemas for verdicts, typed events for trajectory
  logging. Models are increasingly reliable at producing structured data on
  demand.

- **Context management.** Decomposition, handoff, checkpointing. As projects
  grow beyond single-context scale, every tool needs a strategy for this.
  Ridgeline's phase + handoff approach is one of the cleanest implementations.

- **Adversarial verification.** Separating the builder from the reviewer is a
  pattern that improves reliability regardless of model capability. The
  reviewer's job is to find problems, not validate success.

These are not ridgeline-specific inventions. They are reasonable engineering
patterns that happen to work well with AI agents. Ridgeline implements them at
the harness level, so it benefits from any model that supports them -- today's
models and tomorrow's.

## What Doesn't Change

No matter how capable models become, certain fundamentals remain:

- **Specs are still necessary.** A vague request produces vague results
  regardless of model capability. Garbage in, garbage out.

- **Verification is still necessary.** Even very capable models make mistakes on
  complex, stateful codebases. The review loop catches what the builder misses.

- **Checkpoints are still necessary.** Rollback capability is a property of the
  process. Builds can fail for reasons outside the model's control -- network
  issues, dependency conflicts, spec ambiguity.

- **Phase structure still adds value.** Even if a single phase could encompass
  an entire project, the structure provides auditability (what happened when),
  resumability (pick up where you left off), and cost isolation (budget per
  phase, not per project).

Ridgeline is not betting on a specific model or capability level. It implements
a sound engineering process that gets better as its tools get better.
