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

Specialist sub-agents (verifier, explorer, tester, auditor) also improve.
Better tool use means the verifier runs more thorough verification, the explorer
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

## Other Providers

Model-agnostic also means provider-agnostic. Ridgeline runs on
[fascicle](https://github.com/GreyhavenHQ/fascicle), which fronts seven provider
adapters (Anthropic, OpenAI, Google, OpenRouter, Ollama, LM Studio, and the
Claude CLI) behind one interface. Every flow -- `plan`, `refine`, `research`,
and `build` -- can be driven by any of them.

Two execution paths sit behind that interface. Claude models run on the Claude
CLI (`claude_cli`), the subscription/OAuth path that delegates tools to the
CLI's built-ins -- this stays byte-for-byte unchanged and remains the default.
Every other provider runs the same work through fascicle's in-process tool loop
against ridgeline's own tool surface (`Read`, `Write`, `Edit`, `Glob`, `Grep`,
a greywall-sandboxed `Bash`, and `WebFetch`/`WebSearch` for research). Pick a
provider with a `provider:model` string (`openai:gpt-4o`, `google:gemini-2.5-pro`)
or the `provider` field in `.ridgeline/settings.json`.

The single-shot flows (`plan`, `refine`, `research`) accept any configured
provider today. The autonomous `build` is gated more conservatively: it is the
longest, most expensive, most tool-intensive flow, and agent quality on a long
build varies by provider. So non-Claude builds are enabled per-provider via an
allowlist (`ENGINE_BUILDER_PROVIDERS` in `src/commands/build.ts`); OpenRouter is
the first provider validated end-to-end and on the list. To turn another on: run
a small build on that provider in a throwaway sandboxed repo, confirm the phases
pass review, then add the provider to the allowlist. Claude builds are
unaffected -- they keep the CLI path regardless of whether an API key is present,
so a key never silently reroutes a build onto a metered API.

### Provider attribution and cost

Each recorded cost entry in `budget.json` -- and the matching `trajectory.jsonl`
events -- carries the **actual** `provider` and `model` that produced it (ground
truth from the engine, not the requested string), plus a `phase_provider`
trajectory event logging the routing decision per phase. So the artifacts always
show which provider ran each phase; a `claude_cli` entry on a run you launched
elsewhere is the misroute signal. `ridgeline ui` surfaces a per-provider cost
breakdown alongside the per-role one.

fascicle prices its built-in model catalog (Anthropic, OpenAI, …) automatically,
so cost tracking and the `--max-budget-usd` cap work out of the box there.
Providers it does not price -- notably **OpenRouter** -- otherwise report `$0`,
which means a budget cap silently can't bound them. Two things close that gap:
supply per-model rates under a `pricing` key in `.ridgeline/settings.json`, keyed
by the same `provider:model_id` colon form you pass to `--model`, and the cap
starts working for that model; and if you set a cap on an unpriced non-Claude
model without supplying rates, `build` warns up front rather than running
silently uncapped. `ollama`/`lmstudio` are treated as free, so they need no
entry.

```json
{
  "pricing": {
    "openrouter:qwen/qwen3-coder-30b-a3b-instruct": {
      "input_per_million": 0.07,
      "output_per_million": 0.26
    }
  }
}
```

### Hybrid routing (per-role models)

One model rarely has the right cost profile for every role in the pipeline.
Judgment roles (planning, review) shape or gate everything downstream, so they
deserve a frontier model; volume roles (building, research) burn the most
tokens doing comparatively mechanical work, so they are where a cheap provider
pays off. A `models` map in `.ridgeline/settings.json` routes each role
independently -- no flags, one invocation:

```json
{
  "model": "opus",
  "models": {
    "builder": "openrouter:qwen/qwen3-coder-30b-a3b-instruct",
    "researcher": "openrouter:qwen/qwen3-coder-30b-a3b-instruct"
  },
  "pricing": {
    "openrouter:qwen/qwen3-coder-30b-a3b-instruct": {
      "input_per_million": 0.07,
      "output_per_million": 0.26
    }
  }
}
```

With that settings file, `ridgeline build` runs the builder on OpenRouter while
the reviewer stays on the Claude CLI -- in the same invocation, with both
routing decisions logged as `phase_provider` trajectory events and every cost
entry attributed to the provider that actually ran.

Each value takes the same form as `model` (bare family or `provider:model_id`).
A role absent from `models` falls back to `model`, then to the built-in
default. An explicit `--model` on the command line overrides **every** role --
the single-model invocation behaves exactly as before.

The recommended matrix:

| Role | Recommended | Why |
| --- | --- | --- |
| `planner` | frontier (`opus`) | decomposition judgment shapes the whole run |
| `reviewer` | frontier (`opus`) | adversarial review is the quality gate |
| `builder` | cheap volume (e.g. `openrouter:qwen/qwen3-coder-30b-a3b-instruct`) | highest token volume; the reviewer catches misses |
| `researcher` | cheap volume (OpenRouter) | breadth over depth |
| `specifier` | Claude family | the spec ensemble runs on the Claude CLI only today |
| `refiner` | default or cheap | mechanical merge of research findings |

Caveats worth knowing:

- The planner sizes phases for the **builder's** model (context window, "Target
  Model" in its prompt), so a small builder gets appropriately smaller phases
  even when the planner itself runs on a frontier model.
- Non-Claude `builder`/`reviewer` values are still gated by the
  `ENGINE_BUILDER_PROVIDERS` allowlist above; the budget-cap warning checks
  each role's model separately.
- `specifier` and plan **revision** (the synthesizer re-run after a rejected
  plan) run on the Claude CLI only today -- give those roles Claude-family
  values. Choosing *which* Claude model (`opus` vs `sonnet`) works fine.
- `contextWindows` overrides are keyed by the full model string, so a key like
  `"openrouter:qwen/qwen3-coder-30b-a3b-instruct"` matches a builder role set
  to that value.

This is the same theme as the rest of this document: the harness encodes a sound
process, and it benefits from whatever model -- or provider -- you point it at.

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
