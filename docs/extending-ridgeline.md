# Extending Ridgeline

Ridgeline is a build engine, not a closed system. Its agents, skills, and
plugins are extension points that let you inject domain knowledge, custom
workflows, and project-specific intelligence at every level of the pipeline.

The flexibility comes from Claude's own plugin architecture. Ridgeline layers
on top of it, threading user-provided extensions into the builder and reviewer
agents automatically. You don't modify ridgeline's source -- you drop files
into the right directories and the harness picks them up.

## Extension Layers

Extensions can live at four levels, each with different scope and lifetime:

```text
~/.claude/                          ← User-level (all Claude sessions)
<project>/.claude/                  ← Project-level (all Claude work in this repo)
<project>/.ridgeline/plugin/        ← Ridgeline-wide (all builds in this repo)
<project>/.ridgeline/builds/<name>/plugin/  ← Build-specific (one build only)
```

These layers compose. A build-specific agent and a project-level skill are
both available to the builder simultaneously. This lets you start broad and
get specific as needed.

### User-level: `~/.claude/`

Your personal Claude configuration. Agents, skills, commands, and hooks here
apply to every Claude session on your machine -- ridgeline builds included.

**Use for:** Personal workflow preferences, coding conventions you always
follow, utility agents you use everywhere.

This layer is not ridgeline-specific. It's standard Claude CLI configuration
that ridgeline inherits because it spawns Claude as a subprocess.

### Project-level: `<project>/.claude/`

Checked into your repo. Applies to all Claude work in this project -- both
interactive Claude sessions and ridgeline builds.

**Use for:** Stabilized project-wide concerns. Your team's coding standards,
project architecture knowledge, shared utility commands. Things that are true
about the project regardless of whether ridgeline is running.

### Ridgeline-wide: `.ridgeline/plugin/`

Applies to all ridgeline builds in this project, but not to interactive Claude
sessions. This is the sweet spot for ridgeline-specific extensions that don't
belong in the broader project configuration.

**Use for:** Custom agents or skills that enhance the build pipeline. A
domain-specific reviewer helper. A deployment validator. Things that matter
during automated builds but aren't relevant to day-to-day coding.

Ridgeline auto-generates a `plugin.json` manifest if you don't provide one.
Just create the directory and drop in your files -- the harness handles
discovery.

### Build-specific: `.ridgeline/builds/<name>/plugin/`

Scoped to a single build. This is where you experiment. Try a custom agent for
one build, measure the results, keep it or discard it.

**Use for:** Build-specific domain knowledge. A specialist agent that
understands the particular API you're integrating with. A skill that generates
boilerplate for a framework only this build uses. Experimental extensions you
haven't promoted to the project level yet.

## What You Can Extend

Claude's plugin system supports several component types, all of which are
available to ridgeline's builder and reviewer agents:

### Agents

Markdown files with YAML frontmatter. The builder and reviewer can delegate to
them via the Agent tool.

```text
plugin/agents/api-expert.md
```

```markdown
---
name: api-expert
description: Reviews REST API design for consistency with company API standards
model: sonnet
---

You are an API design reviewer. You check REST endpoints against the company's
API style guide...
```

Agents are discovered automatically. No registration needed -- if the file has
valid frontmatter and lives in the right directory, it's available.

### Skills

Markdown files in a named subdirectory. Skills provide structured guidance that
agents can invoke.

```text
plugin/skills/migration-guide/SKILL.md
```

### Commands

Slash commands that agents or users can invoke.

```text
plugin/commands/validate-schema.md
```

### Hooks

Event-driven automation that fires on specific Claude lifecycle events
(PreToolUse, PostToolUse, Stop, etc.).

```text
plugin/hooks/lint-on-save.md
```

### MCP Servers

Model Context Protocol servers that provide external tool integrations --
database access, API clients, documentation retrieval.

## Real-World Patterns

### Domain-Specific Reviewer Assistants

Your reviewer checks acceptance criteria, but domain knowledge makes it
sharper. A specialist agent that understands your specific domain can be
delegated to by the reviewer for deeper verification.

**Example: Database migration validator**

`.ridgeline/plugin/agents/migration-validator.md`

```markdown
---
name: migration-validator
description: Validates database migrations for safety and reversibility
model: sonnet
---

You validate database migrations. For each migration file:

1. Check that every CREATE TABLE has a corresponding DROP in the down migration
2. Verify that ALTER TABLE operations are backwards-compatible
3. Flag any data-destructive operations (DROP COLUMN, TRUNCATE)
4. Ensure migrations run in the correct order (timestamps or sequence numbers)
5. Verify that the migration can be rolled back cleanly

Read the migration files, check the schema state, and report issues.
```

The reviewer can delegate to this agent when it encounters migration files in
the git diff, getting focused analysis without consuming its own context budget.

### Framework-Specific Builder Helpers

When building on a specific framework, a specialist agent with deep knowledge
of that framework's patterns can help the builder make better decisions.

**Example: Next.js app router expert**

`.ridgeline/builds/web-dashboard/plugin/agents/nextjs-expert.md`

```markdown
---
name: nextjs-expert
description: Advises on Next.js App Router patterns, server components, and data fetching
model: sonnet
---

You are a Next.js App Router specialist. When consulted:

1. Advise on server vs. client component boundaries
2. Recommend appropriate data fetching patterns (server components, route
   handlers, server actions)
3. Check that metadata exports follow Next.js conventions
4. Verify that "use client" directives are placed correctly
5. Flag patterns that work in Pages Router but not App Router

Reference the project's existing patterns in app/ before suggesting new ones.
```

This lives at the build level because only the `web-dashboard` build needs it.
Other builds in the same project might use a different framework entirely.

### Project Architecture Guards

Some architectural decisions should be enforced across all builds, not just
documented in constraints.

**Example: Boundary enforcement agent**

`.ridgeline/plugin/agents/boundary-guard.md`

```markdown
---
name: boundary-guard
description: Enforces module boundary rules - checks imports don't cross architectural layers
model: sonnet
---

You enforce the project's module boundary rules:

- src/routes/ may import from src/services/ and src/db/, but not from other routes
- src/services/ may import from src/db/ and src/lib/, but not from src/routes/
- src/db/ may only import from src/lib/
- src/lib/ has no import restrictions but must not import from any other src/ directory
- No circular dependencies between modules

Scan the changed files, trace their imports, and report any boundary violations.
```

This lives at the ridgeline-wide level because it applies to every build in the
project. The reviewer can delegate to it for any phase that modifies source
files.

### Test Strategy Customization

Different builds may need different testing approaches. A build-specific
testing agent can guide the builder toward the right test patterns.

**Example: Integration test specialist for an API build**

`.ridgeline/builds/api-v2/plugin/agents/integration-tester.md`

```markdown
---
name: integration-tester
description: Writes integration tests that hit real endpoints with test database fixtures
model: sonnet
---

You write integration tests for this API. Rules:

1. Tests use the shared test harness in test/helpers/setup.ts
2. Each test file seeds its own data using factories in test/factories/
3. Tests hit real HTTP endpoints via supertest, not internal function calls
4. Assert on response status, body structure, and side effects (database state)
5. Clean up test data in afterEach, not afterAll
6. Group related endpoints in describe blocks by resource

Read the existing tests in test/integration/ to match the established patterns
before writing new ones.
```

### Layered Constraints for Experimentation

The real power emerges when you combine extension layers with ridgeline's
constraint and taste system. The same spec can produce different builds by
varying what context the agents receive.

**Experiment: comparing framework choices**

Run the same spec with different constraints to evaluate approaches:

```sh
# Build with Express
ridgeline spec api-express --constraints ./experiments/constraints-express.md
ridgeline build api-express

# Build with Fastify
ridgeline spec api-fastify --constraints ./experiments/constraints-fastify.md
ridgeline build api-fastify
```

Each build can also have its own plugin directory with framework-specific
agents:

```text
.ridgeline/builds/api-express/plugin/agents/express-expert.md
.ridgeline/builds/api-fastify/plugin/agents/fastify-expert.md
```

Same spec, different constraints, different specialist agents -- different
results you can compare side by side.

### Convention Enforcement via Hooks

Hooks fire on Claude lifecycle events and can enforce conventions automatically.

**Example: Commit message validation**

`.ridgeline/plugin/hooks/validate-commits.md`

A PreToolUse hook on the Bash tool can intercept `git commit` commands and
validate that commit messages follow your project's conventions before the
commit executes.

### MCP Servers for External Context

MCP servers bring external data into the agent's context -- documentation,
API schemas, database state, issue trackers.

**Example: Internal API documentation server**

If your build integrates with internal services, an MCP server can provide
the builder with up-to-date API documentation without embedding it in the
spec or constraints:

```text
.ridgeline/plugin/.mcp.json
```

```json
{
  "mcpServers": {
    "internal-docs": {
      "command": "npx",
      "args": ["internal-docs-server", "--port", "3001"]
    }
  }
}
```

The builder can query the MCP server for endpoint schemas, authentication
requirements, and response formats -- pulling live documentation rather than
relying on what was current when the spec was written.

## Tuning Your Builds

The extension system is designed for iteration. Start simple, observe results,
add context where it helps.

**Start with just spec + constraints.** Run a build. See where the builder
makes poor decisions or the reviewer misses issues.

**Add a specialist agent** for the area that needs improvement. A domain expert
agent that the builder can delegate to. Run the build again. Compare.

**Promote what works.** If a build-specific agent proves valuable across
builds, move it to `.ridgeline/plugin/`. If it's useful beyond ridgeline, move
it to `.claude/`.

**Remove what doesn't help.** An agent that never gets delegated to is noise in
the discovery list. A skill that produces generic advice isn't worth the context
cost. Be willing to discard extensions that don't earn their keep.

**Vary constraints, not just extensions.** Sometimes the best tuning is in the
constraints file, not the plugin directory. A more specific check command, a
tighter directory structure rule, or an explicit dependency restriction can
improve build quality more than a custom agent.

The goal is not maximum configuration. The goal is the minimum configuration
that produces the output you want. Ridgeline provides the engine. Your
extensions provide the domain knowledge. Together they produce builds that
neither could achieve alone.
