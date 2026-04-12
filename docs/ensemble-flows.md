# Ensemble Flows

Ridgeline uses an ensemble pattern at three decision points in the pipeline:
**specifying** (turning a shape into a spec), **researching** (investigating
the spec against external sources), and **planning** (turning a spec into
phases). All three flows run multiple specialist agents in parallel, each
bringing a different perspective, then merge their proposals through a
synthesizer agent. The underlying engine is identical -- a generic
`invokeEnsemble<TDraft>` function parameterized by draft type, agent
directory, and prompt construction.

This document explains the shared ensemble engine, the three flows built on
it, and why the pattern improves output quality.

## The Ensemble Engine

Both the specifier and planner pipelines are thin wrappers around a single
generic ensemble runner. The runner handles all the mechanics -- discovery,
parallel invocation, threshold checks, budget guards, synthesis, and
verification -- so the individual pipelines only need to supply prompts,
schemas, and domain-specific configuration.

```mermaid
flowchart TB
    subgraph engine ["invokeEnsemble<TDraft>"]
        direction TB
        discover["1. Discover specialists\nagents/{dir}/*.md"]
        invoke["2. Invoke in parallel\nPromise.allSettled()"]
        collect["3. Collect proposals\n≥ ceil(n/2) required"]
        budget["4. Budget guard\nhalt if over cap"]
        synth["5. Synthesize\nmerge proposals → output files"]
        verify["6. Verify\noptional post-synthesis check"]

        discover --> invoke --> collect --> budget --> synth --> verify
    end
```

### Stage 1: Specialist Discovery

The engine scans `agents/{dir}/` for markdown files with frontmatter
containing a `perspective` field. Each file defines a specialist personality --
a prompt overlay that shapes how it approaches the problem. Excluded files
(like `context.md` for planners) are filtered out. Adding or removing a
specialist is a matter of adding or deleting a `.md` file -- no code changes.

### Stage 2: Parallel Invocation

All specialists run concurrently. Each receives:

- A **system prompt** built from the specialist's overlay
- A **user prompt** containing the input documents
- A **JSON schema** enforcing structured output (when `isStructured` is true)
- Tools are pipeline-specific -- specifier and planner specialists have **no
  tools** and return JSON, while researcher specialists have **WebFetch,
  WebSearch, and Bash** and return prose markdown

The engine's `isStructured` flag controls the output mode. When true (used by
specifier and planner ensembles), specialists return schema-validated JSON
drafts. When false (used by the researcher ensemble), specialists return
free-form markdown text. The synthesizer handles both modes.

Parallelism means wall-clock time is bounded by the slowest specialist, not
the sum of all.

### Stage 3: Proposal Collection

Results are collected via `Promise.allSettled()`. The engine requires at least
`ceil(n / 2)` successful proposals to proceed:

| Specialists | Minimum required |
|-------------|-----------------|
| 2           | 1               |
| 3           | 2               |
| 4           | 2               |
| 5           | 3               |

Failed specialists (timeouts, parse errors) are logged but do not block the
run. The threshold adapts automatically as specialists are added or removed.

### Stage 4: Budget Guard

If the combined specialist cost already meets or exceeds `--max-budget-usd`,
the engine halts before invoking the synthesizer. This prevents a wasted
synthesis call when the build cannot continue.

### Stage 5: Synthesis

The synthesizer agent receives all successful proposals alongside the original
inputs. Unlike specialists, it has the **Write** tool and produces the final
output files. It applies judgment-based merging -- reading the rationale behind
each proposal and making contextual decisions -- rather than mechanical voting
or averaging.

### Stage 6: Verification

An optional callback runs after synthesis to confirm the expected files were
created. If verification fails, the ensemble throws, surfacing the problem
immediately.

### Cost and Duration

```text
wall-clock = max(specialist durations) + synthesizer duration
total cost = sum(all specialist costs) + synthesizer cost
```

Budget tracking records each role as a separate entry with labels, so cost
attribution is transparent down to individual specialists.

---

## Specifier Ensemble

The specifier ensemble turns a rough `shape.md` into a precise `spec.md`,
`constraints.md`, and optionally `taste.md`. It runs as part of the
`ridgeline spec` command.

```mermaid
flowchart LR
    shape[shape.md] --> specialists

    subgraph specialists ["Parallel Specialists"]
        direction TB
        comp[Completeness]
        clar[Clarity]
        prag[Pragmatism]
    end

    specialists --> proposals["Structured\nJSON drafts"]
    proposals --> synthesizer[Specifier\nSynthesizer]
    synthesizer -->|writes| spec[spec.md]
    synthesizer -->|writes| constraints[constraints.md]
    synthesizer -->|writes| taste[taste.md\noptional]
```

### Specialist Perspectives

| Specialist | Focus | Tendency |
|------------|-------|----------|
| **Completeness** | Nothing missing | Covers edge cases, error states, validation, security surfaces. Fills gaps with reasonable defaults. Errs on including too much. |
| **Clarity** | Nothing ambiguous | Converts vague language to concrete, testable criteria. "Fast responses" becomes "under 200ms at p95". Every acceptance criterion should be mechanically verifiable. |
| **Pragmatism** | Everything buildable | Flags underspecified or unrealistically ambitious features. Suggests proven technical defaults. Proposes scope cuts when needed. |

### What Specialists Produce

Each specialist returns a structured JSON draft containing:

- **spec** -- title, overview, features with acceptance criteria, scope boundaries
- **constraints** -- language, runtime, framework, directory/naming conventions,
  dependencies, check command
- **taste** -- code style, test patterns, commit format (or null if shape has no
  style preferences)
- **tradeoffs** -- what the approach sacrifices
- **concerns** -- things the other specialists might miss

### Synthesis Strategy

The specifier synthesizer applies five steps:

1. **Identify consensus** -- where all three specialists agree, adopt directly
2. **Resolve conflicts** -- balance completeness vs pragmatism based on declared
   scope size
3. **Incorporate unique insights** -- include single-specialist concerns that
   address genuine risks
4. **Sharpen language** -- apply the clarity specialist's precision throughout
5. **Respect the shape** -- do not add or remove features beyond declared scope

A critical rule: the spec describes **what**, never **how**. "The API validates
input" is a spec concern. "Use Zod for input validation" is a constraint.

### Verification

After synthesis, the engine confirms that `spec.md` and `constraints.md` exist
in the build directory. If either is missing, the run fails immediately.

---

## Planner Ensemble

The planner ensemble decomposes a spec into sequential build phases. It runs
as part of the `ridgeline plan` command.

```mermaid
flowchart LR
    inputs["spec.md\nconstraints.md\ntaste.md"] --> specialists

    subgraph specialists ["Parallel Specialists"]
        direction TB
        simp[Simplicity]
        vel[Velocity]
        thor[Thoroughness]
    end

    specialists --> proposals["Structured\nJSON proposals"]
    proposals --> synthesizer[Planner\nSynthesizer]
    synthesizer -->|writes| phases["phases/\n01-scaffold.md\n02-core.md\n..."]
```

### Specialist Perspectives

| Specialist | Focus | Tendency |
|------------|-------|----------|
| **Simplicity** | Fewest phases, most pragmatic boundaries | Combines aggressively. Every phase must justify its existence through a concrete technical dependency. Avoids "organizational tidiness" phases. |
| **Velocity** | Fastest time to working product | Front-loads visible, high-value features. Phase 1 should produce something interactive. Defers polish and optimization. Progressive enhancement. |
| **Thoroughness** | Comprehensive coverage from the start | Edge cases, validation, security, observability. Scopes to the wider interpretation of ambiguity. Better to propose phases the synthesizer trims than to miss concerns. |

### What Specialists Produce

Each specialist returns a structured JSON proposal:

```json
{
  "perspective": "simplicity",
  "summary": "Three-phase plan focusing on...",
  "phases": [
    {
      "title": "Project Scaffold",
      "slug": "project-scaffold",
      "goal": "Establish base project structure...",
      "acceptanceCriteria": ["...", "..."],
      "specReference": "Sections 1-2 of spec.md",
      "rationale": "Groups all foundational work..."
    }
  ],
  "tradeoffs": "Defers edge-case handling to..."
}
```

### Shared Context

Planner specialists share a `context.md` document that provides common
grounding -- the rules of phase decomposition, sizing guidelines, and output
expectations. This shared context is prepended to each specialist's system
prompt alongside their personality overlay.

### Synthesis Strategy

The planner synthesizer applies the same five-step judgment process:

1. **Identify consensus** -- phases all specialists agree on are strong candidates
2. **Resolve conflicts** -- balance completeness with pragmatism, consider each
   rationale
3. **Incorporate unique insights** -- surface what any single viewpoint would miss
4. **Trim excess** -- remove marginal-value phases
5. **Respect phase sizing** -- target ~50% of the builder model's context window,
   leaving headroom for codebase exploration and tool use

### Verification

After synthesis, the engine scans the phases directory and fails if no phase
files were created.

---

## Researcher Ensemble

The researcher ensemble investigates a spec against external sources. It runs
as part of the `ridgeline research` command and is optional -- users can skip
it and go directly from spec to plan. See [Research and Refine](research.md)
for the full user guide.

```mermaid
flowchart LR
    inputs["spec.md\nconstraints.md\ntaste.md\nexisting research.md"] --> agenda

    agenda["Agenda Step (sonnet)\nreads spec + gaps.md +\nexisting research.md"] --> specialists

    subgraph specialists ["Parallel Specialists"]
        direction TB
        acad[Academic]
        eco[Ecosystem]
        comp[Competitive]
    end

    specialists --> reports["Prose markdown\nresearch reports"]
    reports --> synthesizer[Researcher\nSynthesizer]
    synthesizer -->|appends to| research["research.md\n(accumulated)"]
```

### Specialist Perspectives

| Specialist | Focus | Tendency |
|------------|-------|----------|
| **Academic** | Novel algorithms, architectures, recent papers | Searches arxiv, Semantic Scholar, Google Scholar. Finds cutting-edge techniques that could simplify or improve the spec's approach. Flags known pitfalls from research. |
| **Ecosystem** | Framework docs, library features, version updates | Checks official docs, release notes, changelogs, migration guides. Surfaces built-in solutions that would replace custom implementations. Catches deprecations. |
| **Competitive** | How other tools solve the same problem | Investigates GitHub repos, product pages, developer discussions. Identifies well-considered patterns, common feature requests, and documented anti-patterns. |

### Quick vs Deep Mode

In **quick mode** (default, no flag), only the first specialist (ecosystem)
runs. This is faster and focused on the immediate tech stack -- good for a
sanity check against the latest documentation.

In **deep mode** (`--deep`), all three specialists run in parallel. This
provides broader coverage across academic research, ecosystem updates, and
competitive landscape.

### Agenda Pre-step

Before dispatching specialists, the researcher ensemble runs a gap analysis
agenda step using a sonnet call. The agenda step reads the current spec,
the flavour's `gaps.md` (a domain-specific gap checklist), and any existing
`research.md` from prior iterations. It produces a focused research agenda
that tells each specialist exactly which gaps to investigate, avoiding
redundant work and directing effort toward areas not yet covered.

Specialists receive this focused agenda alongside the spec and constraints,
so their web searches and analysis target the most valuable open questions
rather than covering ground that previous iterations have already resolved.

The synthesizer reads the existing `research.md` and appends new findings
rather than replacing it. This means research accumulates across iterations
-- each pass adds depth without losing prior discoveries.

### Differences from Other Ensembles

The researcher ensemble differs from the specifier and planner ensembles in
two ways:

1. **Specialists have tools.** Research specialists use WebFetch, WebSearch,
   and Bash to access the web. Specifier and planner specialists have no tools
   and reason from inputs alone.

2. **Output is prose, not JSON.** The engine runs with `isStructured: false`.
   Specialists produce free-form markdown research reports rather than
   schema-validated JSON drafts. The synthesizer reads these reports and merges
   them into a structured `research.md` file.

### Auto Mode

The `--auto [N]` flag chains research and refine into an iterative loop
(default: 2 iterations). Each iteration runs the research ensemble, then
invokes the refiner agent (a single agent, not an ensemble) to rewrite
`spec.md` incorporating the findings. Because `research.md` accumulates
findings across iterations rather than being overwritten, each pass builds
on prior discoveries -- the agenda step reads the existing research to
identify remaining gaps, and the synthesizer appends new findings. The next
iteration researches the updated spec with awareness of what has already
been covered, enabling progressively deeper exploration. See
[Research and Refine -- Auto Mode](research.md#auto-mode) for details.

### Verification

After synthesis, the engine confirms that `research.md` exists in the build
directory. If missing, the run fails immediately.

---

## How Ensembles Improve Quality

### Perspective Diversity

No single agent holds all viewpoints. A simplicity-focused agent will not
think about edge cases. A thoroughness-focused agent will not think about time
to first demo. A velocity-focused agent will not think about long-term
robustness. The ensemble ensures all lenses are applied.[^1]

```mermaid
flowchart TB
    subgraph "Single Agent"
        direction TB
        single["One implicit set\nof priorities"]
        blind["Blind spots\nin coverage"]
        single --> blind
    end

    subgraph "Ensemble"
        direction TB
        multi["Three explicit\nperspectives"]
        synth["Synthesizer merges\nwith full visibility"]
        multi --> synth
        synth --> covered["Blind spots\nsurfaced and resolved"]
    end
```

### Structured Disagreement as Signal

When specialists disagree on boundaries, scope, or sequencing, the
disagreement itself is informative. It highlights genuine tension in the
requirements -- places where the right answer depends on priorities that are
not explicitly stated.

**Example**: a spec for a web app with user input forms.

- **Simplicity** folds validation into the form phase -- it is all one feature,
  separating them creates an unnecessary context transition.
- **Thoroughness** proposes a dedicated validation phase covering edge cases,
  error messages, and injection prevention.
- The **synthesizer** sees both rationales. If the spec involves straightforward
  field checks, simplicity is right. If it involves cross-field rules, async
  validation, and security hardening, thoroughness is right. The synthesizer
  makes the call based on actual complexity -- a judgment a single agent would
  have made implicitly and possibly incorrectly.

### Judgment, Not Voting

The ensemble explicitly rejects majority voting or weighted scoring. The
synthesizer reads the rationale behind each proposal and decides in context.
A concern raised by only one specialist can override consensus from the other
two if the reasoning is compelling -- a security risk from the thoroughness
planner, for example, should not be dismissed because simplicity and velocity
did not mention it.[^2]

The value is not in averaging perspectives. It is in ensuring nothing important
is missed.

### Graceful Degradation

The 50% success threshold means transient failures do not block the pipeline.
If one specialist times out or returns unparseable output, the ensemble
continues with the remaining proposals. This resilience is automatic -- no
retry logic, no manual intervention.

---

## End-to-End Flow

The three ensembles sit at adjacent stages of the pipeline. Together they
transform a rough idea into a fully decomposed build plan:

```mermaid
flowchart LR
    shape[shape.md] --> spec_ensemble

    subgraph spec_ensemble ["Specifier Ensemble"]
        direction TB
        s_spec["3 specialists\n(completeness, clarity, pragmatism)"]
        s_synth["Synthesizer"]
        s_spec --> s_synth
    end

    spec_ensemble -->|writes| spec[spec.md]
    spec_ensemble -->|writes| constraints[constraints.md]
    spec_ensemble -->|writes| taste[taste.md]

    spec --> research_ensemble
    spec -->|skip research| plan_ensemble

    subgraph research_ensemble ["Researcher Ensemble (optional)"]
        direction TB
        r_spec["1-3 specialists\n(academic, ecosystem, competitive)"]
        r_synth["Synthesizer"]
        r_spec --> r_synth
    end

    research_ensemble -->|writes| research[research.md]
    research --> refiner[Refiner Agent]
    refiner -->|rewrites| spec2[spec.md]
    spec2 --> plan_ensemble

    constraints --> plan_ensemble
    taste --> plan_ensemble

    subgraph plan_ensemble ["Planner Ensemble"]
        direction TB
        p_spec["3 specialists\n(simplicity, velocity, thoroughness)"]
        p_synth["Synthesizer"]
        p_spec --> p_synth
    end

    plan_ensemble -->|writes| phases["phases/\n01-scaffold.md\n02-core.md\n03-polish.md"]

    phases --> builder[Builder Agent]
```

The specifier and planner ensembles each cost four Claude calls (three
specialists + one synthesizer). The researcher ensemble costs two to four
calls depending on quick vs deep mode. The tradeoff is worth it because these
stages make high-leverage decisions: the specifier defines **what** gets built,
the researcher validates it against external sources, and the planner defines
**in what order**. Errors at any stage cascade through the entire build.
Investing in quality at these decision points pays for itself many times over
in avoided rework downstream.

---

## Extensibility

All three ensembles are designed to be extended without code changes:

- **New specialists**: drop a `.md` file in `src/agents/specifiers/`,
  `src/agents/researchers/`, or `src/agents/planners/` with `name`,
  `description`, and `perspective` frontmatter. The engine discovers it
  automatically on the next run.

- **Different synthesis strategies**: edit `src/agents/core/specifier.md`,
  `src/agents/core/researcher.md`, or `src/agents/core/planner.md` to change
  how proposals are merged -- weight certain perspectives, apply domain
  heuristics, or adjust sizing targets.

- **New ensemble pipelines**: the generic `invokeEnsemble<TDraft>` function
  can be reused for any future pipeline stage that benefits from multi-
  perspective reasoning. Supply a config object and a draft type, and the
  engine handles the rest.

[^1]: **Further reading:** [7 Ensemble AI Patterns for Reliable LLM Systems](https://dev.to/atanasster/7-ensemble-ai-patterns-for-reliable-llm-systems-200l) — Catalogues ensemble patterns including specialist diversity and synthesis strategies for improving LLM output quality.
[^2]: **Further reading:** [The AI Code Agent Orchestra](https://addyosmani.com/blog/code-agent-orchestra/) — Addy Osmani's analysis of multi-agent orchestration, including how synthesis-over-voting produces better outcomes than mechanical aggregation.
