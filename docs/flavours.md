# Flavours

Flavours are domain-specific agent sets that replace ridgeline's generic agents
with ones that understand a particular domain. A game development flavour knows
about game engines, asset pipelines, and framerate targets. A legal drafting
flavour knows about contract structure and clause dependencies. The pipeline
stages are the same -- shape, spec, plan, build, review -- but the agents
running them speak your domain's language.

## Why flavours matter

Ridgeline's default agents are generalists. They produce competent software
across a wide range of projects, but they don't bring domain-specific judgment.
A generalist planner won't think about level loading order. A generalist
reviewer won't flag contract clause ambiguity.

Flavours solve this by swapping the agent prompts at every pipeline stage. The
shaper asks domain-relevant questions. The specifier ensemble evaluates
completeness through a domain lens. The planner decomposes work using
domain-appropriate phase boundaries. The builder follows domain conventions. The
reviewer checks domain-specific acceptance criteria.

The result is output that reads like it was produced by someone who works in
your field, not someone who read about it.

## Available flavours

Ridgeline ships with these built-in flavours:

| Flavour | Domain |
|---------|--------|
| `data-analysis` | Data pipelines, notebooks, statistical analysis |
| `game-dev` | Game engines, mechanics, asset integration, physics |
| `legal-drafting` | Contracts, clauses, legal document structure |
| `machine-learning` | Model training, datasets, evaluation, deployment |
| `mobile-app` | iOS/Android, platform APIs, responsive layouts |
| `music-composition` | Audio generation, notation, arrangement, synthesis |
| `novel-writing` | Long-form fiction, narrative structure, prose style |
| `screenwriting` | Scripts, scene structure, dialogue, formatting |
| `security-audit` | Vulnerability analysis, threat modeling, compliance |
| `software-engineering` | General software with engineering-focused rigor |
| `technical-writing` | Documentation, guides, API references |
| `test-suite` | Test strategy, coverage, fixture design |
| `translation` | Multilingual content, localization, cultural adaptation |
| `web-game` | Browser-based games and interactive visual applications (canvas, WebGL, PixiJS, Phaser, Three.js) |
| `web-ui` | Web application UI development with responsive layouts, CSS auditing, and accessibility |

## Using a flavour

### Per-command

Pass `--flavour` on any pipeline command:

```sh
ridgeline shape my-project --flavour game-dev
ridgeline spec my-project --flavour game-dev
ridgeline plan my-project --flavour game-dev
ridgeline build my-project --flavour game-dev
```

### As a default

Set a flavour in `.ridgeline/settings.json` so it applies to all commands
without repeating the flag:

```json
{
  "flavour": "game-dev"
}
```

The CLI flag overrides the setting when both are present.

## What a flavour contains

A flavour is a directory with up to four subfolders, mirroring the structure of
ridgeline's default agents:

```text
game-dev/
├── core/
│   ├── shaper.md        ← Intake Q&A, tailored to domain
│   ├── specifier.md     ← Spec synthesis, domain-aware
│   ├── planner.md       ← Phase decomposition, domain conventions
│   ├── builder.md       ← Implementation, domain patterns
│   └── reviewer.md      ← Acceptance checking, domain criteria
├── planners/
│   ├── context.md       ← Shared planning context
│   ├── velocity.md      ← Speed-focused planning perspective
│   ├── thoroughness.md  ← Quality-focused planning perspective
│   └── simplicity.md    ← MVP-focused planning perspective
├── specifiers/
│   ├── completeness.md  ← "Is anything missing?"
│   ├── clarity.md       ← "Is this unambiguous?"
│   └── pragmatism.md    ← "Is this buildable?"
├── researchers/
│   ├── academic.md     ← Academic research perspective
│   ├── competitive.md  ← Competitive analysis perspective
│   ├── ecosystem.md    ← Ecosystem/docs research perspective
│   └── gaps.md         ← Domain gap checklist for focused research
└── specialists/
    ├── auditor.md       ← Domain-specific auditing
    ├── explorer.md      ← Codebase exploration
    ├── tester.md        ← Test strategy
    └── verifier.md      ← Output verification
```

The `gaps.md` file is a static checklist, not an agent. It provides a
domain-specific list of concerns and knowledge gaps that the research agenda
step reads before dispatching specialists. For example, a game-dev `gaps.md`
might list rendering pipeline choices, physics engine tradeoffs, and
platform-specific performance concerns. This focuses research on the
questions that matter most in the domain.

### flavour.json and recommended skills

A flavour can optionally include a `flavour.json` file at its root. This file
declares metadata about the flavour, including which Claude Code skills work
best with it:

```json
{
  "recommendedSkills": [
    "visual-tools/screenshot",
    "visual-tools/css-audit"
  ]
}
```

The `recommendedSkills` array lists skill names that complement the flavour.
These are Claude Code skills (skills 2.0 format) that teach Claude how to use
specific CLI tools. Skills in `plugin/visual-tools/skills/` are discovered
automatically.

When you run `ridgeline create` for a project that uses a flavour with
`recommendedSkills`, ridgeline checks whether those skills are installed and
displays a summary. For example:

```text
Recommended skills for web-ui:
  ✓ visual-tools/screenshot  (installed)
  ✗ visual-tools/css-audit   (not found)

Missing skills won't block anything — install them whenever you're ready.
```

Missing skills are informational only. They do not prevent project creation,
building, or any other pipeline command. The summary is a convenience to help
you set up the best environment for the flavour upfront.

### Per-folder fallback

You don't need to provide every subfolder. The agent registry resolves each
subfolder independently:

```mermaid
flowchart TB
    resolve["Resolve agents\nfor each subfolder"]

    resolve --> core{"Flavour has\ncore/?}
    core -->|yes| use_flavour_core["Use flavour core agents"]
    core -->|no| use_default_core["Use default core agents"]

    resolve --> spec{"Flavour has\nspecifiers/?}
    spec -->|yes| use_flavour_spec["Use flavour specifiers"]
    spec -->|no| use_default_spec["Use default specifiers"]

    resolve --> plan{"Flavour has\nplanners/?}
    plan -->|yes| use_flavour_plan["Use flavour planners"]
    plan -->|no| use_default_plan["Use default planners"]

    resolve --> research{"Flavour has\nresearchers/?}
    research -->|yes| use_flavour_res["Use flavour researchers"]
    research -->|no| use_default_res["Use default researchers"]

    resolve --> gaps{"Flavour has\ngaps.md?"}
    gaps -->|yes| use_flavour_gaps["Use flavour gaps.md"]
    gaps -->|no| use_base_gaps["Use base gaps.md\n(always available)"]
```

This means a minimal flavour can override just the core agents and inherit
everything else.

The `gaps.md` file has independent fallback -- if a flavour does not provide
its own `researchers/gaps.md`, the base gap checklist is used regardless of
whether the flavour overrides other researcher files. This ensures every
research run has gap guidance even when a flavour only customizes a subset
of research agents.

## How flavours affect each stage

### Shape

The shaper asks questions through a domain lens. A game-dev shaper probes for
engine choice, target platform, input methods, art style, and gameplay
mechanics. A legal-drafting shaper asks about jurisdiction, contract type,
parties, and governing law. The shape document that comes out is grounded in
domain vocabulary and concerns.

### Research

The flavour's `researchers/` subfolder customizes the research pipeline. Domain
researcher agents (academic, ecosystem, competitive) focus their web searches
and analysis on domain-relevant sources and concerns. The `gaps.md` checklist
steers the agenda step toward domain-specific questions -- a security-audit
flavour's gap checklist probes for vulnerability databases and compliance
frameworks, while a machine-learning flavour's checklist focuses on dataset
licensing, model architecture benchmarks, and training infrastructure options.
Together, the researcher agents and gap checklist ensure the research pipeline
investigates what actually matters in the domain rather than applying generic
due diligence.

### Spec

The specifier ensemble -- completeness, clarity, and pragmatism specialists --
evaluates the spec against domain expectations. A game-dev completeness
specialist checks whether audio, input handling, and collision systems are
addressed. A mobile-app clarity specialist flags ambiguous platform-specific
behavior.

### Plan

Planner specialists decompose work using domain-appropriate boundaries. A
game-dev planner might separate "core mechanics" from "level design" from
"audio integration". A machine-learning planner might separate "data
preparation" from "model training" from "evaluation pipeline". The velocity,
thoroughness, and simplicity perspectives are calibrated to the domain's
tradeoffs.

### Build

The builder follows domain conventions. A game-dev builder understands scene
graphs, component architecture, and asset loading. A mobile-app builder knows
about navigation stacks, platform APIs, and responsive layout. A `web-ui`
builder takes responsive screenshots and runs CSS audits and accessibility
checks against each viewport. A `web-game` builder captures canvas screenshots
and validates shaders as it iterates. The builder's constraints interpretation
is filtered through domain expertise.

### Review

The reviewer applies domain-specific acceptance criteria. A game-dev reviewer
checks framerate targets, collision accuracy, and input responsiveness. A
security-audit reviewer checks for vulnerability classes, threat coverage, and
compliance requirements. A `web-ui` reviewer verifies visual quality across
viewports. A `web-game` reviewer checks rendering quality and game feel.

## Custom flavours

You can create your own flavour as a directory anywhere on your filesystem and
reference it by path:

```sh
ridgeline build my-project --flavour ./my-flavours/fintech/
```

Any path containing `/`, `.`, or `~` is treated as a filesystem path rather
than a built-in flavour name. The path is resolved relative to your current
working directory.

Structure your custom flavour directory the same way as the built-ins -- `core/`,
`planners/`, `specifiers/`, `specialists/`. Include only the subfolders you
want to override. The rest fall back to ridgeline's defaults.

### Writing a core agent

Each core agent file is a markdown file with YAML frontmatter:

```markdown
---
name: builder
description: Implements a single phase spec for fintech — transactions, ledgers, compliance
model: opus
---

You are a fintech developer. You receive a single phase spec and implement it.

## Your inputs

1. **Phase spec** — your assignment.
2. **constraints.md** — non-negotiable technical guardrails.
3. **taste.md** (optional) — style preferences.
4. **handoff.md** — accumulated state from prior phases.
5. **feedback file** (retry only) — reviewer feedback on what failed.

...
```

Study the built-in flavours in `src/flavours/` for the full prompt structure
each agent role expects.

### Writing a specialist

Specialist files in `planners/` and `specifiers/` use a `perspective` field in
their frontmatter that names their evaluation lens. The body provides the
overlay prompt that is prepended to the base agent's instructions:

```markdown
---
name: compliance-check
perspective: regulatory compliance
---

Evaluate every decision through the lens of financial regulation. Flag anything
that could create compliance exposure...
```

## Step-by-step: creating a custom flavour

This walkthrough builds a project-local fintech flavour from scratch.

### 1. Choose your scope

Start minimal. A flavour only needs `core/builder.md` and `core/reviewer.md` to
work. Everything else falls back to ridgeline's defaults. Start with just these
two and expand only when the defaults don't fit.

### 2. Create the directory structure

Create a project-local custom flavour directory:

```sh
mkdir -p .ridgeline/flavours/fintech/core
```

Ridgeline resolves custom flavours from three locations:

- **Project-local:** `.ridgeline/flavours/` in your project root.
- **User-global:** `~/.ridgeline/flavours/` for flavours shared across projects.
- **Filesystem path:** any absolute or relative path passed to `--flavour`.

### 3. Add flavour.json

Create a `flavour.json` at the flavour root. This file is optional but useful
for declaring recommended skills:

```json
{
  "recommendedSkills": []
}
```

See the [flavour.json and recommended skills](#flavourjson-and-recommended-skills)
section above for details on what this file supports.

### 4. Write core/builder.md

Create `core/builder.md` with YAML frontmatter and domain-specific instructions:

```markdown
---
name: builder
description: Implements a single phase spec for fintech — transactions, ledgers, compliance
model: opus
---

You are a fintech developer specializing in financial systems. You receive a single phase spec and implement it.

Focus on:
- Transaction integrity and atomicity
- Ledger accuracy and audit trails
- Regulatory compliance (PCI-DSS, SOX where applicable)
- Secure handling of financial data

## Your inputs

1. **Phase spec** — your assignment.
2. **constraints.md** — non-negotiable technical guardrails.
3. **taste.md** (optional) — style preferences.
4. **handoff.md** — accumulated state from prior phases.
5. **feedback file** (retry only) — reviewer feedback on what failed.
```

Study the built-in flavours in `src/flavours/` for the full prompt structure
each role expects. The example above is a starting point -- production flavours
typically include more detailed instructions for tool use, output format, and
domain conventions.

### 5. Write core/reviewer.md

Create `core/reviewer.md` with domain-specific acceptance criteria:

```markdown
---
name: reviewer
description: Reviews builds for fintech correctness — transaction safety, compliance, audit trails
model: opus
---

You are a fintech code reviewer. Evaluate the builder's work against the phase spec and constraints.

Pay special attention to:
- Transaction boundaries and rollback safety
- Data integrity across ledger operations
- Input validation on financial amounts
- Compliance with regulatory requirements in constraints.md
```

### 6. Add specialists (optional)

You can add `specifiers/`, `planners/`, and `researchers/` directories with
specialist agents that use the `perspective` frontmatter field. See
[Writing a specialist](#writing-a-specialist) above for the format. Only add
these when the default specialists don't bring enough domain judgment to the
stage.

### 7. Test your flavour

Run any pipeline command with your custom flavour path:

```sh
ridgeline shape my-project --flavour .ridgeline/flavours/fintech
```

Or set it as the default in `.ridgeline/settings.json` so it applies to all
commands:

```json
{
  "flavour": ".ridgeline/flavours/fintech"
}
```

### 8. Iterate

Use `ridgeline dry-run` to preview plans without building. Check that the
planner decomposes work with domain-appropriate phase boundaries -- for fintech,
you'd expect phases around transaction processing, ledger reconciliation, and
compliance validation rather than generic frontend/backend splits.

Review the generated specs and plans to confirm the domain vocabulary is present
and the acceptance criteria match your expectations. Adjust your core agent
prompts and add specialists as gaps surface.

## Flavours vs. plugins

Flavours and plugins serve different purposes:

- **Flavours** replace the core pipeline agents. They change *how ridgeline
  thinks* at every stage.
- **Plugins** add *additional* agents, skills, hooks, and commands that the
  pipeline agents can use as tools. They extend capabilities without replacing
  the core.

You can use both together. A `game-dev` flavour gives you domain-native core
agents, while a project-level plugin might add a `sprite-validator` specialist
agent that the builder can delegate to. The flavour shapes the thinking; the
plugin provides extra tools.
