# Ridgeline for Decision-Makers

A non-technical overview of what Ridgeline does, why it matters, and how it
compares to alternatives.

---

## What Ridgeline Does

Most AI coding tools work like a single contractor with a hammer -- they take
a prompt, generate some code, and hope for the best. Ridgeline works
differently.

**Ridgeline is to AI-assisted development what a general contractor is to
construction -- it does not do the work itself, but it plans the phases,
coordinates the specialists, inspects the results, and manages the budget.**

Give Ridgeline a description of what you want built, and it will:

- Analyze your codebase and ask clarifying questions
- Write a detailed specification
- Optionally research best practices and prior art
- Decompose the work into ordered phases with acceptance criteria
- Execute each phase using AI agents in a sandboxed environment
- Review every phase against its acceptance criteria before proceeding
- Retry or fail gracefully when quality gates are not met
- Track costs in real time and halt if a budget cap is reached
- Checkpoint progress in git so nothing is lost

The result is a structured, auditable, resumable pipeline that turns a
high-level idea into shipped code -- with guardrails at every step.

---

## How It Works

Ridgeline follows a pipeline of stages. Each stage produces artifacts that feed
the next. The pipeline can be run end-to-end with a single command or stage by
stage for manual review at each step.

```text
  +----------+      +----------+      +----------+
  |          |      |          |      |          |
  |  SHAPE   +----->+   SPEC   +----->+ RESEARCH |
  |          |      |          |      | (opt-in) |
  +----------+      +----------+      +----+-----+
  Describe what       Three AI               |
  you want.           specialists        +---v------+
  Codebase            debate and         |          |
  analysis +          merge into         |  REFINE  |
  clarifying          spec.md,           | (opt-in) |
  questions.          constraints.md     +----+-----+
                                              |
          +-----------------------------------+
          |
    +-----v----+      +----------+      +----------+
    |          |      |          |      |          |
    |   PLAN   +----->+  BUILD   +----->+  REVIEW  |
    |          |      |          |      |          |
    +----------+      +-----+----+      +-----+----+
    Three planner           |                 |
    specialists        Phase-by-phase    Pass? Advance.
    propose phases,    execution in      Fail? Generate
    synthesizer        sandboxed git     feedback, retry.
    merges them.       worktree.
                                          |
                                    +-----v------+
                                    |  RETRY or  |
                                    |  ADVANCE   |
                                    +------------+
```

Each stage produces versioned artifacts stored in a `.ridgeline/` directory
alongside your code. Every build step creates a git checkpoint, so you can
inspect, rewind, or resume at any point.

---

## Key Capabilities

### Ensemble Intelligence

> Multiple AI specialists collaborate, like a design review board.

Rather than relying on a single AI to get everything right, Ridgeline uses an
**ensemble pattern**: three specialist agents with different perspectives (e.g.,
completeness, clarity, and pragmatism for specs; simplicity, thoroughness, and
velocity for planning) draft independent proposals. A synthesizer agent then
merges the best elements into a single output.

This mimics how real engineering teams work -- through debate and synthesis --
and consistently produces higher-quality results than any single agent alone.

### Cost Governance

> Built-in budget caps prevent runaway spend.

Every AI invocation is metered. Ridgeline tracks cumulative cost across all
phases and agents, and will halt the build immediately if a configurable budget
ceiling is reached. Cost data is recorded per phase and per agent in
`budget.json`, giving full visibility into where money is spent.

No more surprise invoices from unattended AI runs.

### Quality Gates

> Every phase passes automated review before proceeding.

After each build phase, a dedicated read-only reviewer agent checks the output
against the phase's acceptance criteria. If the review fails, Ridgeline
generates structured feedback and retries the build -- up to a configurable
limit. Phases do not advance until they pass.

This means defects are caught at the phase level, not at the end of a long
build, dramatically reducing rework.

### Resumability

> Pick up where you left off -- no wasted work or money.

Every completed phase is checkpointed in git. If a build is interrupted --
whether by a failure, a budget cap, or a user decision -- you can resume from
the last successful phase. No work is repeated, no cost is duplicated.

Run `ridgeline build my-feature` again and it picks up exactly where it
stopped.

### Domain Expertise

> Pre-configured for 15 domains, from web apps to legal drafting.

Ridgeline ships with 15 built-in **flavours** -- domain-specific agent
configurations that tune prompts, constraints, and review criteria for
particular use cases:

| Category         | Flavours                                            |
|------------------|-----------------------------------------------------|
| Software         | software-engineering, web-ui, mobile-app, web-game, game-dev |
| Data & ML        | data-analysis, machine-learning                     |
| Security         | security-audit, test-suite                          |
| Content          | novel-writing, screenwriting, technical-writing     |
| Specialized      | legal-drafting, translation, music-composition      |

Custom flavours can be created by pointing to a directory of agent prompt files.

### Parallel Execution

> Independent phases run concurrently, cutting build time.

When the planner produces phases with no dependencies between them, Ridgeline
can schedule them for concurrent execution. The phase dependency graph (a DAG)
ensures correct ordering while maximizing parallelism.

---

## Architecture at a Glance

### The Pipeline

```text
 .ridgeline/builds/my-feature/
 |
 |  shape.md -----> spec.md + constraints.md -----> phases/
 |                   (ensemble: 3 specialists       01-scaffold.md
 |                    + synthesizer)                 02-core-logic.md
 |                                                  03-api-layer.md
 |                                                  04-tests.md
 |
 |  state.json      budget.json      trajectory.jsonl
 |  (progress)      (cost tracking)  (event log)
```

### The Ensemble Specialist-Synthesizer Pattern

This is the core innovation behind Ridgeline's quality. It is used in the Spec,
Research, and Plan stages.

```text
                  +------------------+
                  |   Input Artifact |
                  |   (e.g. shape.md)|
                  +--------+---------+
                           |
              +------------+------------+
              |            |            |
     +--------v--+  +------v----+  +---v---------+
     | Specialist |  | Specialist|  | Specialist  |
     | A          |  | B         |  | C           |
     | (focused on|  | (focused  |  | (focused on |
     |  complete- |  |  on       |  |  pragmatism)|
     |  ness)     |  |  clarity) |  |             |
     +--------+---+  +-----+----+  +------+------+
              |            |              |
              +------------+--------------+
                           |
                  +--------v---------+
                  |   SYNTHESIZER    |
                  |                  |
                  |  Merges the best |
                  |  elements from   |
                  |  all proposals   |
                  +--------+---------+
                           |
                  +--------v---------+
                  |  Output Artifact |
                  |  (e.g. spec.md)  |
                  +------------------+
```

### Phase Dependency DAG Example

The planner decomposes work into phases, some of which depend on others. The
build engine schedules independent phases concurrently while respecting
dependencies.

```text
  01-scaffold ------+
                    |
  02-data-model ----+----> 04-api-layer ----> 06-integration-tests
                    |
  03-auth-module ---+----> 05-ui-components
```

In this example, phases 01, 02, and 03 can run in parallel. Phase 04 waits for
02 and 03. Phase 05 waits for 03. Phase 06 waits for 04. The build engine
handles this scheduling automatically.

---

## Competitive Landscape

| Feature                          | Ridgeline                         | Composio Agent Orchestrator       | GitHub Agentic Workflows          | Mastra / LangGraph                |
|----------------------------------|-----------------------------------|-----------------------------------|-----------------------------------|-----------------------------------|
| **Multi-agent ensemble**         | Yes -- 3 specialists + synthesizer per stage | Single-agent per task             | Single-agent per workflow step    | Custom agent graphs (manual)      |
| **Structured review loops**      | Built-in reviewer with retry      | No built-in review                | PR-based review only              | Must build manually               |
| **Cost tracking and caps**       | Per-phase metering, budget caps   | No built-in cost tracking         | No built-in cost tracking         | No built-in cost tracking         |
| **Git-native checkpointing**     | Every phase tagged in git         | No version control integration    | Git-based but no phase checkpoints| No built-in checkpointing         |
| **Resumable builds**             | Resume from last checkpoint       | Restart from beginning            | Restart from beginning            | Must build manually               |
| **Sandbox security**             | Greywall + bubblewrap auto-detect | Varies by integration             | GitHub-hosted runners             | No built-in sandboxing            |
| **Domain flavours**              | 15 built-in, extensible           | None                              | None                              | None                              |
| **Phase dependency scheduling**  | DAG-based parallel execution      | Sequential only                   | Workflow-defined                  | Graph-defined (manual)            |
| **Setup complexity**             | `npm install -g ridgeline`        | Platform account + config         | GitHub Actions YAML               | SDK integration + custom code     |
| **Long-horizon builds**          | Purpose-built                     | Task-level orchestration          | CI/CD-oriented                    | General-purpose framework         |

**Key differentiator:** Ridgeline is the only tool in this space that combines
multi-agent ensembles, structured quality gates, cost governance, and git-native
resumability in a single purpose-built harness for long-horizon software builds.

---

## Risk Mitigation

| Risk                  | How Ridgeline Addresses It                                                                 |
|-----------------------|--------------------------------------------------------------------------------------------|
| **Cost overruns**     | Real-time cost metering per phase and per agent. Configurable budget caps halt the build instantly when exceeded. Full cost breakdown in `budget.json`. |
| **Quality failures**  | Every phase is reviewed by a dedicated AI reviewer against acceptance criteria. Failed phases receive structured feedback and are retried. Phases do not advance until they pass. |
| **Security exposure** | Builds run inside sandboxed environments (Greywall on macOS/Linux, bubblewrap on Linux). Network access is restricted to an allowlist. Filesystem access is isolated. Sandboxing is on by default. |
| **Reproducibility**   | Every phase creates a git checkpoint (tag). The full event history is logged in `trajectory.jsonl`. Build state, cost data, and all artifacts are stored in version-controlled files. Any build can be inspected, rewound, or replayed. |
| **Wasted work**       | Builds resume from the last successful checkpoint. Interrupted builds do not repeat completed phases. Budget caps prevent spending money on builds that have already exceeded their allocation. |
| **Vendor lock-in**    | All artifacts are plain Markdown and JSON stored in your git repository. Phase specs, constraints, and review criteria are human-readable and editable. The pipeline can be run stage-by-stage with manual intervention at any point. |

---

## Glossary

**Ensemble** -- A group of AI agents that work on the same problem
independently, each from a different perspective. Their outputs are combined by
a synthesizer to produce a higher-quality result than any single agent could
achieve alone.

**Specialist** -- One of the AI agents in an ensemble. Each specialist has a
specific focus area (e.g., completeness, clarity, pragmatism) that shapes how it
approaches the problem.

**Synthesizer** -- The AI agent that merges the outputs of all specialists in an
ensemble into a single, coherent artifact. It resolves conflicts and selects the
strongest elements from each proposal.

**Phase** -- A discrete unit of work within a build. Each phase has its own
specification, acceptance criteria, and git checkpoint. Phases are executed
sequentially or in parallel according to their dependencies.

**Checkpoint** -- A git tag created at the start of each phase. If a phase
fails, you can reset to its checkpoint and retry. Completed phases also receive
a completion tag.

**Sandbox** -- An isolated execution environment that restricts what the AI
agent can access. Network requests are limited to an allowlist, and filesystem
access is confined to the project directory. Prevents accidental or malicious
side effects.

**Flavour** -- A domain-specific configuration that tunes agent prompts,
constraints, and review criteria for a particular type of work (e.g.,
web-ui, legal-drafting, machine-learning). Ridgeline ships with 15 built-in
flavours and supports custom ones.

**Retrospective** -- A post-build analysis that captures what went well, what
failed, and what could be improved. Findings accumulate across builds to enable
compound learning.

**DAG** -- Directed Acyclic Graph. A scheduling structure where each phase can
declare dependencies on other phases. The build engine uses the DAG to determine
which phases can run in parallel and which must wait for predecessors to
complete.

---

*For technical architecture details, see [architecture.md](architecture.md).
For information on extending Ridgeline with custom flavours, see
[flavours.md](flavours.md).*
