# Build Costs

What a `ridgeline build` costs after Anthropic's June 15, 2026 programmatic-billing
change -- per provider tier, with real measured numbers -- and how to make a build
roughly **10x cheaper** by routing roles to the right model.

If you read one thing: run a build, then open `ridgeline ui` or read the build's
`budget.json`. Ridgeline has always computed per-invocation cost from each provider's
published rates, so the dollar figures it shows are the figures you now pay. This guide
explains what drives them.

## What changed on June 15

Before June 15, driving Claude through the subscription CLI (`claude_cli`, Ridgeline's
default transport -- see [docs/future-models.md](future-models.md#other-providers)) was
covered by your Claude subscription. An overnight `ridgeline build` on Opus drew on the
plan rather than metering per token against a balance, so its incremental cost was
effectively zero no matter how many tokens it burned.

From June 15, **programmatic** use of a subscription is metered at standard API rates.
"Programmatic" means automated, non-interactive invocation -- a harness, agent, or
script driving the model -- which is exactly what Ridgeline does when it runs a build,
plan, or research flow. Interactive use (typing in the Claude apps or Claude Code
yourself) is a separate matter; this guide is only about the automated flows.

The practical upshot: the numbers in `budget.json` stop being informational and start
being your bill. The rest of this guide is about keeping that bill small.

> The exact terms of the change -- any bundled API allotment, prepaid credit, or
> per-plan provisioning -- are set by Anthropic, not Ridgeline, and may shift. Check
> Anthropic's current [pricing](https://platform.claude.com/docs/en/pricing) and plan
> terms for the authoritative billing detail. The model rates below are current as of
> June 2026.

## Anthropic model rates

Per million tokens (MTok). Input is what the model reads (your prompt, the codebase it
explores, prior context); output is what it writes.

| Model | Input $/MTok | Output $/MTok | Context |
| --- | --- | --- | --- |
| Claude Opus 4.8 | $5.00 | $25.00 | 1M |
| Claude Sonnet 4.6 | $3.00 | $15.00 | 1M |
| Claude Haiku 4.5 | $1.00 | $5.00 | 200K |
| Claude Fable 5 | $10.00 | $50.00 | 1M |

Two things make the headline rate misleading on its own:

- **Caching.** A build re-reads a large, stable context (spec, constraints, prior code)
  on every call. Cached reads bill at roughly **0.1x** the input rate; the first write
  that creates a cache entry bills at ~1.25x (5-minute TTL). In a real `budget.json`
  the bulk of a builder's input is cache reads, not full-price input -- which is why a
  phase that "reads" 350K tokens costs far less than 350K x $5/MTok would suggest. See
  the cache-pricing detail in
  [docs/future-models.md](future-models.md#provider-attribution-and-cost).
- **Output dominates.** Output is 5x the input rate. A build's cost tracks how much the
  model *writes and reasons*, not how much it reads.

Non-Claude providers are far cheaper per token. The validated cheap builder,
`openrouter:qwen/qwen3-coder-30b-a3b-instruct`, lists at **$0.07 / $0.26** per MTok --
roughly **70x** cheaper input and **96x** cheaper output than Opus. DeepSeek V4 (also
OpenRouter, Anthropic-Messages-compatible) sits in between at ~$0.44 / $0.87. Those
ratios are where the savings come from.

## What a build costs, per tier

All three tiers below are anchored to the same project --
[`examples/helloworld`](../examples/helloworld), a one-phase build of a single
`hello.js` -- so they are directly comparable. helloworld is *trivial*: a real build
costs more (more phases, more code, more review), but the **ratios** between tiers hold.

| Tier | Routing | Full helloworld build | Source |
| --- | --- | --- | --- |
| All-frontier | every role on Opus (`claude_cli`) | **~$1.5--1.8** per pass | committed `budget.json` |
| Hybrid | builder/researcher cheap, planner/reviewer Opus | between the two -- the Opus reviewer is the floor | Phase 0.3 validation |
| All-cheap | every role on qwen (OpenRouter) | **~$0.12--0.18** | OpenRouter usage delta |

That is the **~10x** span: the same build runs for about a tenth as much when every role
moves from Opus to a cheap OpenRouter model. Both ends are measured, not modeled --
the all-frontier figure from the opus-on-`claude_cli` entries in the example's
committed `budget.json` (which accumulates ~$3.75 across several reruns; a single clean
pass is ~$1.5--1.8), and the all-cheap figure from OpenRouter's own usage rising
~$0.12--0.18 across a full end-to-end qwen build.

### The hybrid tier, and why the reviewer is the floor

Hybrid keeps the two judgment roles (planner, reviewer) on a frontier model and moves
the volume roles (builder, researcher) to a cheap provider. Phase 0.3 measured one
helloworld build phase under hybrid routing:

- **builder** on qwen: 6 model-calls, **$0.39** total (confirmed by an OpenRouter usage
  delta of +$0.391).
- **reviewer** on Opus (`claude_cli`): 2 calls, **$2.11**.

Two lessons fall out of those numbers:

1. **On a builder-heavy build, hybrid approaches the all-cheap savings.** The builder is
   normally the dominant token consumer -- it explores the codebase, writes the code,
   runs checks, and iterates within each phase. Moving that volume to a ~70--96x cheaper
   model pulls total cost down toward the all-cheap figure, while the reviewer stays on
   a frontier model to guard quality. The fraction you save tracks how builder-heavy the
   build is.

2. **Retries can erase the savings.** That phase exhausted its retry budget (the qwen
   builder's output was rejected by the Opus reviewer at `--max-retries 1`), so it is a
   *worst case*. Each rejected attempt re-invokes the frontier reviewer: here the
   reviewer cost $2.11 across 2 calls while the cheap builder cost $0.39 across 6. A
   cheap builder that thrashes against a frontier reviewer makes the **reviewer** the
   cost driver, and the phase can cost more than running it all-frontier. Watch retry
   counts in `state.json`; if a cheap builder cannot satisfy the reviewer, raise the
   builder tier rather than paying for repeated frontier review.

On a trivial build like helloworld the builder volume is tiny, so the fixed review
overhead dominates and hybrid barely helps. On a substantial build the opposite is
true -- which is the case the matrix below is tuned for.

## Estimating your nightly build

A build's cost is roughly:

```text
plan (one-time) + (phases x per-phase build+review)
```

From the all-frontier (Opus) `budget.json`, the building blocks are:

- **plan ensemble**, once per build: ~**$1.0** (specialists + synthesizer, on Opus).
- **per phase** (build + review), on Opus: ~**$0.78** *for a trivial helloworld phase*.
  A real phase that writes meaningful code and gets a thorough review commonly runs
  **$1--3**.

So an all-frontier nightly build of, say, 6 phases lands around **$1 + 6 x $1--3 =
$7--19**, plus any retries. The same build under the hybrid matrix drops the per-phase
*builder* share to pennies, leaving the frontier reviewer as the main per-phase cost --
typically **half to a third** of the all-frontier total on a builder-heavy build. An
all-cheap build of the same shape runs **well under a dollar**, trading frontier
judgment in planning and review for the lowest possible cost.

These are starting estimates. For *your* number, run one build and read its
`budget.json` (or `ridgeline ui`) -- phase count, code volume, and retry behavior vary
enough that one real measurement beats any formula.

## The budget cap

`--max-budget-usd` (or `"maxBudgetUsd"` in `.ridgeline/settings.json`) caps the
**cumulative measured cost** Ridgeline computes across a build, and stops the run when
it is exceeded. How it behaves depends on whether the provider is priced:

- **Claude (`claude_cli`) and other catalog providers** are priced automatically by
  fascicle, so the cap is live out of the box -- it sees and bounds your metered Claude
  spend.
- **Unpriced providers (notably OpenRouter)** otherwise report `$0`, so the cap cannot
  bound them. Supply per-model rates under a `"pricing"` key in `settings.json` (keyed
  by the same `provider:model_id` colon form you pass to `--model`) and the cap starts
  working for that model. If you set a cap on an unpriced non-Claude model without
  supplying rates, `build` warns up front rather than running silently uncapped. The
  mechanism, the `pricing` JSON shape, and the `ollama`/`lmstudio` (free) cases are
  documented in
  [docs/future-models.md](future-models.md#provider-attribution-and-cost) -- that is
  the source of truth; this guide does not repeat it.

**The cap measures gross cost, not your bill.** Ridgeline bounds the gross metered cost
of the run; it does not know your account balance. If your plan bundles an API
allotment or prepaid credit, Anthropic applies that on their side, and your net
out-of-pocket is gross-minus-credit. Set `maxBudgetUsd` to the gross dollar amount you
are willing to spend per build, and treat any credit as a separate cushion.

## Making it ~10x cheaper

The lever is **routing by role**: put the highest-volume role on a cheap provider and
keep the judgment roles on a frontier model. Configure it once in `settings.json` via
the `"models"` map -- no flags, one invocation:

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

The headline of the recommended matrix: **planner and reviewer on a frontier model**
(decomposition and the review gate are pure judgment), **builder and researcher on a
cheap provider** (highest token volume, comparatively mechanical work -- the reviewer
catches misses). The full matrix, the per-role fallback rules, and the caveats (the
planner sizes phases for the *builder's* context window; `specifier` and plan revision
run on the Claude CLI only today) live in
[docs/future-models.md](future-models.md#hybrid-routing-per-role-models).

For the deepest cut, route the reviewer cheap too (all-cheap) -- that is the ~10x
end of the table above -- but you give up frontier judgment on the quality gate, so
reserve it for low-stakes or well-tested builds.

## Seeing real costs

Every entry in a build's `budget.json` records the **actual** provider and model that
produced it (ground truth from the engine, not the requested string), and
`trajectory.jsonl` carries a `phase_provider` event logging the routing decision at each
phase start. `ridgeline ui` renders both a per-role and a per-provider cost breakdown.

A `claude_cli` entry on a run you launched on another provider is the misroute signal --
the build silently fell back to your subscription. After June 15 that is also a billing
signal: it means you paid metered Claude rates for work you meant to run cheaply.
