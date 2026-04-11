# Spec-Driven Development

## What is Spec-Driven Development

Spec-driven development is the practice of describing software outcomes before
implementation begins. The spec is the source of truth. Everything downstream
-- phase decomposition, implementation, verification -- derives from it.

In ridgeline, specs describe **what** the system does. Constraints describe
**guardrails**. Taste describes **style**. The planner and builder decide
**how**. This separation is deliberate: the user controls outcomes and
boundaries, the agents handle execution.

## The Three-Layer Spec System

Ridgeline uses three input files, each with a distinct role:

### spec.md -- What to Build

The spec describes features as outcomes and behaviors. What the system does, who
uses it, what it produces. No implementation details.

```markdown
# Task Management API

Create a REST API for managing tasks with the following capabilities:

1. Users can create, read, update, and delete tasks.
2. Tasks have a title, description, status (todo, in-progress, done), and due date.
3. Users authenticate with email and password via JWT.
4. The API validates all input and returns structured error responses.
5. Tasks are scoped to the authenticated user -- users cannot see or modify
   other users' tasks.
```

Notice what this does not say: no mention of Express vs. Fastify, no file
structure, no database choice, no specific validation library. Those belong in
constraints.

### constraints.md -- Technical Guardrails

Constraints are non-negotiable. The builder cannot violate them. They define the
technical boundaries within which the builder operates.

```markdown
# Constraints

- Language: TypeScript (strict mode)
- Runtime: Node.js 22
- Framework: Fastify
- ORM: Drizzle with PostgreSQL
- Directory structure: src/routes/, src/db/, src/middleware/
- Test framework: Vitest
- No additional runtime dependencies without justification

## Check Command

\`\`\`bash
npm test && npm run typecheck
\`\`\`
```

The check command is particularly important. It defines the mechanical
verification gate that both the builder and reviewer use. If the check command
fails, the phase fails -- regardless of how good the code looks.

### taste.md -- Style Preferences (Optional)

Taste is best-effort. The builder follows it unless there is a concrete reason
not to, and notes any deviations in the handoff.

```markdown
# Taste

- Prefer named exports over default exports
- Use conventional commits: feat(scope): summary
- Tests colocated with source: src/routes/users.test.ts
- Prefer explicit error types over generic Error
- Comments only where intent is non-obvious
```

Taste is useful for maintaining consistency across phases and builds within a
project. It is not enforced by the reviewer -- the reviewer checks acceptance
criteria and constraints, not style preferences.

## The Shape, Specify, and Research Pipeline

Writing specs from scratch can be daunting, especially for large projects.
Ridgeline breaks the process into up to four stages: **shaping**,
**specifying**, and optionally **researching** and **refining**.

### Shaping

```sh
ridgeline shape my-feature "Build a REST API for task management"
```

The shaper agent analyzes your codebase (language, framework, structure) and
asks clarifying questions across up to 4 rounds, grouped by theme: intent and
scope, solution shape and existing landscape, risks and complexities, and
technical preferences. It produces `shape.md` -- a structured document that
captures the project context needed to write a precise spec.

You can provide input upfront to shortcut the Q&A:

```sh
# Detailed description -- shaper skips or reduces clarification rounds
ridgeline shape my-feature "Build a REST API for task management with JWT auth,
PostgreSQL backing, Fastify framework, deployed to AWS Lambda"

# Existing document -- shaper reads it and fills gaps
ridgeline shape my-feature ./existing-requirements.md
```

The shaper does not ask about implementation details. It asks about outcomes,
users, integrations, and scope. Implementation details emerge in the constraints
file during the specifying stage.

### Specifying

```sh
ridgeline spec my-feature
```

The specifier uses an ensemble pattern: three specialist agents -- completeness,
clarity, and pragmatism -- each draft a full spec proposal from the shape
document. A synthesizer agent then merges the proposals, resolving disagreements
and incorporating unique insights, to produce `spec.md`, `constraints.md`, and
optionally `taste.md`.

The ensemble approach surfaces gaps that a single agent would miss. The
completeness specialist covers edge cases and error states. The clarity
specialist converts vague language into concrete, testable criteria. The
pragmatism specialist flags unrealistic scope and suggests proven defaults.
See [Ensemble Flows](ensemble-flows.md) for details on the ensemble pattern.

### Researching and Refining (Optional)

```sh
ridgeline research my-feature --deep
ridgeline refine my-feature
```

After specifying, you can optionally research the spec using web sources
before planning. The research ensemble investigates the spec against academic
literature, ecosystem documentation, and competitive landscape -- surfacing
information that prevents costly mistakes downstream.

Before dispatching specialists, a lightweight agenda step evaluates the spec
against a domain gap checklist (`gaps.md`), focusing the search on what's
actually missing. Findings accumulate across iterations rather than being
overwritten.

The refiner then merges research findings back into `spec.md`, adding insights
and edge cases without removing user-authored content. It also writes
`spec.changelog.md` documenting what changed and why, so future iterations
avoid redundant work. Sources are cited inline so you can trace what came from
research.

The `--auto` flag chains research and refine for multiple iterations (default
2), progressively improving the spec:

```sh
ridgeline research my-feature --deep --auto 2
```

This is particularly useful when the spec involves unfamiliar technology,
complex architectural decisions, or libraries where recent version changes
matter. For well-understood domains and simple specs, skip research and go
straight to planning.

See [Research and Refine](research.md) for the full guide.

## Flexibility: Loose to Precise

Ridgeline works across a wide spectrum of spec detail. More detail produces more
predictable output, but less detail still works.

**Minimal spec.** A one-paragraph description and basic constraints. The planner
fills in the gaps, the builder makes judgment calls. Good for prototyping,
exploring ideas, or when you trust the agent's judgment.

```markdown
# Spec
Build a CLI tool that converts CSV files to JSON.

# Constraints
- Language: TypeScript
- No external dependencies
```

This is enough. The planner will produce a single phase (or two, if it decides
to separate core logic from CLI handling). The builder will make reasonable
choices about argument parsing, error handling, and output format.

**Moderate spec.** Features described with clear outcomes. Constraints specify
framework and structure. The planner produces well-scoped phases with testable
acceptance criteria.

**Detailed spec.** Comprehensive feature descriptions, explicit acceptance
criteria per feature, detailed constraints, style preferences. The planner maps
features to phases almost mechanically. Good for repeatable, precise builds
where the output must match a specific design.

The system doesn't require a particular level of detail. It adapts. But the
relationship is straightforward: **more precise input produces more predictable
output.**

## When to Use Ridgeline

Ridgeline is a good fit when the work can be described as outcomes and verified
mechanically.

**Greenfield features.** New features or modules where the spec can fully
describe the desired outcome. The builder starts from a clean slate (or a
well-understood existing codebase) and implements to spec.

**Well-defined projects with verifiable criteria.** Projects where "done" means
tests pass, endpoints return expected data, files exist in the right structure.
The reviewer can check these mechanically.

**Projects that exceed a single context window.** This is the core use case. If
your project is large enough that a single agent session loses coherence before
finishing, ridgeline's phase decomposition and handoff mechanism keep things on
track.

**Repeatable builds.** The same spec + constraints + taste should produce
consistent results across runs. Good for CI-like workflows or when you need to
rebuild a feature with different constraints.

**Brownfield additions.** Adding new features to existing codebases, provided
the constraints accurately describe the existing structure. The builder explores
the codebase, reads the handoff, and integrates with what's already there.

## When Not to Use Ridgeline

Ridgeline is not the right tool for every problem.

**Exploratory coding.** "I'll know it when I see it" is not a spec. If you
don't know what you want, you need an interactive session with rapid feedback,
not an autonomous build pipeline. Use Claude CLI directly and iterate.

**UI design iteration.** Visual design requires human judgment at each step --
does this look right? does this feel right? Ridgeline's review loop checks
acceptance criteria, not aesthetic quality. If the acceptance criteria are "the
button is blue and centered," ridgeline can verify that. If the criteria are
"the interface feels intuitive," it cannot.

**Tasks requiring human judgment mid-build.** The build pipeline is autonomous.
There is no "pause and ask the user" step between phases. If a decision in
phase 3 depends on human review of phase 2's output, ridgeline is not the right
tool. (The user can always review between manual `ridgeline build` invocations,
but the pipeline itself does not prompt for input.)

**Tiny one-off changes.** A single file edit, a config tweak, a quick bug fix.
These do not need a three-agent pipeline with phase decomposition and
adversarial review. Use Claude CLI directly.

**Tasks without clear acceptance criteria.** If you cannot describe what "done"
looks like in verifiable terms, the reviewer cannot do its job. "Make the code
better" is not a spec. "All functions have JSDoc comments and the linter passes
with zero warnings" is.

## Writing Good Specs

A few guidelines for specs that produce good results:

**Describe outcomes, not steps.** "Users can log in with email and password" --
not "Create a login form with two input fields and a submit button that POSTs
to /api/auth/login." The builder decides the implementation. The spec describes
what the user experiences.

**Make acceptance criteria verifiable.** "GET /api/users returns 200 with a JSON
array" -- not "the user management system works." The reviewer needs to be able
to run a command, check an output, or inspect a file to confirm each criterion.

**Be specific about scope boundaries.** What is explicitly out of scope prevents
the planner from over-scoping. "Authentication is in scope. Authorization
(role-based access) is not." This clarity saves phases and budget.

**Include codebase context for brownfield projects.** If the project already has
conventions, describe them in constraints. "Existing routes are in
src/routes/\<resource>.ts. Follow the same pattern." The builder will explore
anyway, but explicit guidance prevents unnecessary divergence.

**Let the specifier help.** The interactive Q&A surfaces gaps you might not
think of. Even if you have a clear vision, running `ridgeline spec` can
tighten the spec before the planner sees it.
