# Constraints and Taste

## Two Kinds of Guidance

Ridgeline separates technical guidance into two files with different enforcement
levels:

- **constraints.md** -- non-negotiable. The builder cannot violate these. The
  reviewer verifies adherence. Violations fail the phase.
- **taste.md** -- best-effort. The builder follows these unless there is a
  concrete reason not to. Deviations are noted in the handoff. The reviewer
  does not check taste.

This separation exists because not all guidance carries the same weight. "Use
TypeScript" is a hard requirement -- building in JavaScript when the spec says
TypeScript is wrong regardless of outcome. "Prefer named exports over default
exports" is a style preference -- using a default export in one file is not a
build failure, even if it is mildly inconsistent.

Conflating the two creates problems in both directions. Enforcing style
preferences as hard gates produces unnecessary retries when the builder makes
reasonable deviations. Treating technical requirements as soft guidance produces
builds that silently violate the spec. The two-file system makes the enforcement
level explicit.

## Constraints

Constraints define the technical boundaries within which the builder operates.
They typically cover:

- **Language and runtime.** TypeScript, Node.js 22, strict mode.
- **Framework.** Fastify, Next.js, Express -- whatever the project requires.
- **Directory structure.** Where source files, tests, routes, and configuration
  live.
- **Dependencies.** Allowed or forbidden packages. Restrictions like "no
  additional runtime dependencies without justification."
- **Naming conventions.** File naming, export patterns, database table naming.
- **Check command.** The mechanical verification gate.

### How Each Agent Uses Constraints

**Planner.** Reads constraints to make informed decomposition decisions. A
constraint specifying a complex framework (e.g., Next.js App Router) may lead
the planner to allocate more context budget to phases that involve that
framework. The planner does not repeat constraints in phase specs -- the builder
receives constraints separately.

**Builder.** Treats constraints as hard rules. The builder reads constraints
before implementation and follows them throughout. A constraint violation is an
automatic failure regardless of whether acceptance criteria pass. If a
constraint conflicts with a practical implementation need, the builder notes the
conflict in the handoff rather than silently violating the constraint.

**Reviewer.** Verifies constraint adherence as part of every review. It checks
that the language, framework, directory structure, naming conventions, and
dependency restrictions match what constraints specify. A constraint violation
produces a blocking issue in the verdict -- even if every acceptance criterion
passes.

### The Check Command

The check command in constraints is particularly important. It defines the
mechanical verification gate that both the builder and reviewer use:

```markdown
## Check Command

\`\`\`bash
npm test && npm run typecheck && npm run lint
\`\`\`
```

If the check command fails, the phase fails. This is not a suggestion -- it is
a hard gate enforced by the harness. The check command is the simplest and most
reliable quality gate because it runs the same way every time: no judgment, no
interpretation, just pass or fail.

A good check command catches the mechanical problems (type errors, test
failures, lint violations) so the reviewer can focus on the semantic problems
(does the implementation actually satisfy the acceptance criteria?).

## Taste

Taste describes stylistic preferences that promote consistency without creating
rigid gates. Typical taste entries:

- Export style (named vs. default exports)
- Commit message format (conventional commits)
- Test organization (colocated vs. separate directory)
- Comment philosophy (only where intent is non-obvious)
- Error handling patterns (explicit error types vs. generic Error)

### How Agents Use Taste

**Builder.** Reads taste before implementation and follows it as a default. When
the builder has a concrete reason to deviate -- a library requires default
exports, a test framework expects a specific directory structure -- it deviates
and notes the reason in the handoff. Taste guides; it does not constrain.

**Reviewer.** Does not check taste. The reviewer verifies acceptance criteria
and constraints. If the builder used default exports where taste says named
exports, that is not a review failure. This keeps the review focused on
outcomes rather than style.

**Planner.** Receives taste as context but does not make decomposition decisions
based on it. Taste does not affect phase boundaries or sizing.

### Why Taste Matters

Taste may seem optional (and it is -- the file is not required), but it serves a
real purpose: consistency across phases and builds. Without taste, each phase's
builder makes independent style decisions. Phase 1 might use named exports,
phase 3 might use default exports, and the codebase ends up inconsistent. Taste
establishes conventions that carry across context window boundaries.

Taste is also useful across builds in the same project. If multiple builds
contribute to the same codebase, a shared taste file (at the project level)
keeps their outputs stylistically coherent.

## Resolution

Constraints and taste resolve through a three-tier precedence chain:

1. **CLI flag** -- `--constraints <path>` or `--taste <path>`
2. **Build-level** -- `.ridgeline/builds/<build-name>/constraints.md` or
   `taste.md`
3. **Project-level** -- `.ridgeline/constraints.md` or `taste.md`

The first match wins. This enables layered configuration:

- **Project-level** for team-wide standards. "We always use TypeScript, Vitest,
  and this directory structure." Shared across all builds.
- **Build-level** for build-specific overrides. "This build uses Fastify instead
  of Express." Scoped to one build without affecting others.
- **CLI flag** for one-off experiments. "Run this build with different
  constraints to compare approaches."

Constraints are required -- if no constraints file is found at any tier, the
harness exits with an error. Taste is optional -- if not found, the build
proceeds without style guidance.

## Writing Good Constraints

**Be specific.** "Framework: Fastify" -- not "use a modern web framework." The
builder needs concrete boundaries, not vague direction. Ambiguous constraints
lead to inconsistent builds because different builder invocations interpret them
differently.

**Include the check command.** A build without a check command relies entirely
on the reviewer's judgment for mechanical correctness. A check command catches
type errors, test failures, and lint violations deterministically. It is the
cheapest and most reliable quality gate.

**Specify directory structure.** "Routes in `src/routes/`, database in
`src/db/`, middleware in `src/middleware/`." Without this, the builder invents a
structure that may conflict with later phases or existing conventions.

**Restrict dependencies when it matters.** "No additional runtime dependencies
without justification" prevents the builder from pulling in packages that add
maintenance burden. If specific packages are required or forbidden, name them.

**Don't over-constrain.** Constraints that specify implementation details
("use a factory pattern for all database queries") fight the builder's judgment.
The builder should have freedom in how it achieves outcomes. Constrain the
boundaries, not the approach.

## Writing Good Taste

**Keep it short.** Under 20 lines. Taste that runs long gets lost in the
builder's context window. Focus on the choices that come up frequently and where
consistency matters most.

**Be concrete.** "Prefer named exports over default exports" -- not "use good
export patterns." The builder needs a specific convention to follow, not a
principle to interpret.

**Focus on recurring choices.** Taste is most valuable for decisions the builder
makes many times per phase: export style, comment style, naming patterns, test
organization. One-off architectural decisions belong in constraints or the spec.

**Accept deviations.** Taste is best-effort by design. If you find yourself
wanting to enforce a taste entry, it belongs in constraints instead.

## Constraints vs. Taste: A Decision Guide

The heuristic is simple: **if violating it should fail the build, it is a
constraint. If the builder can deviate with justification, it is taste.**

| Guideline | File | Reason |
|-----------|------|--------|
| "Language: TypeScript" | constraints | Wrong language is a build failure |
| "Framework: Fastify" | constraints | Wrong framework is a build failure |
| "Tests in `src/**/*.test.ts`" | constraints | Wrong test location breaks the test runner |
| "Prefer named exports" | taste | Default exports work fine; consistency is nice |
| "Conventional commits" | taste | Commit format does not affect build correctness |
| "No dependencies beyond those listed" | constraints | Unapproved dependencies are a policy violation |
| "Comments only where intent is non-obvious" | taste | Comment style does not affect functionality |
| "Check: `npm test && npm run typecheck`" | constraints | The verification gate must be enforced |

When in doubt, start with taste. If the build produces problems because the
builder deviates, promote the entry to constraints. It is easier to tighten than
to loosen.
