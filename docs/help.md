# Command Reference

## Requirements

- **Claude CLI** -- installed and authenticated (`claude` must be on PATH)
- **Node.js** -- for running ridgeline itself
- **Git** -- the project directory must be a git repository
- **Greywall** (optional) -- for network allowlist sandboxing on macOS/Linux (`brew install greywall`)
- **bwrap** (optional) -- for network and filesystem sandboxing on Linux

## Install

```sh
npm install -g ridgeline
```

## Commands

### `ridgeline [build-name] [input]` (default)

Auto-advance the build through the next incomplete pipeline stage
(shape → spec → plan → build; research and refine are opt-in). Accepts all flags from the individual commands.

```sh
ridgeline my-feature "Build a REST API for task management"
```

### `ridgeline shape [build-name] [input]`

Gather project context through interactive Q&A and codebase analysis. Produces
`shape.md` in `.ridgeline/builds/<build-name>/`. The optional `input` argument
can be a file path to an existing document or a natural language description.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | `opus` | Model for shaper agent |
| `--timeout <minutes>` | `10` | Max duration per turn |

```sh
# Interactive mode
ridgeline shape my-feature

# From a description
ridgeline shape my-feature "Build a REST API for task management with JWT auth"

# From an existing document
ridgeline shape my-feature ./existing-spec.md
```

### `ridgeline spec [build-name]`

Run the specifier ensemble to produce `spec.md`, `constraints.md`, and
optionally `taste.md`. Three specialist agents (completeness, clarity,
pragmatism) draft proposals in parallel, then a synthesizer merges them.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | `opus` | Model for specifier agents |
| `--timeout <minutes>` | `10` | Max duration per turn |
| `--max-budget-usd <n>` | none | Halt if cumulative cost exceeds this amount |

```sh
ridgeline spec my-feature
```

### `ridgeline research [build-name]`

Research the spec using web sources. Optional step between `spec` and `plan`.

| Flag | Default | Description |
|------|---------|-------------|
| `--deep` | off | Run full ensemble (3 specialists: academic, ecosystem, competitive) instead of quick single-agent mode |
| `--auto [N]` | off | Auto-loop: research + refine for N iterations (default 2 if no number given) |
| `--model <name>` | `opus` | Model for research agents |
| `--timeout <minutes>` | `15` | Max duration per agent |
| `--max-budget-usd <n>` | none | Halt if cumulative research cost exceeds this amount |

```sh
ridgeline research my-feature              # Quick research (1 agent)
ridgeline research my-feature --deep       # Deep research (3 specialists)
ridgeline research my-feature --auto       # 2 auto iterations
ridgeline research my-feature --auto 5     # 5 auto iterations
ridgeline research my-feature --deep --auto 2  # Deep + 2 auto iterations
```

### `ridgeline refine [build-name]`

Merge research.md findings into spec.md and write spec.changelog.md documenting
what changed. Run after reviewing/editing research.md.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | `opus` | Model for refiner agent |
| `--timeout <minutes>` | `10` | Max duration |

```sh
ridgeline refine my-feature
```

### `ridgeline plan [build-name]`

Run the planner ensemble to decompose the spec into numbered phase files
(`01-slug.md`, `02-slug.md`, ...) stored in the build's `phases/` directory.
Three specialist planners (simplicity, thoroughness, velocity) propose in
parallel, then a synthesizer merges them.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | `opus` | Model for planner agents |
| `--timeout <minutes>` | `120` | Max planning duration |
| `--constraints <path>` | auto | Path to constraints file |
| `--taste <path>` | auto | Path to taste file |

```sh
ridgeline plan my-feature
```

### `ridgeline dry-run [build-name]`

Display the execution plan without invoking builders or reviewers. Runs the
planner if no phases exist yet. Shows each phase with its title, goal summary,
and acceptance criteria.

Accepts the same flags as `plan`.

```sh
ridgeline dry-run my-feature
```

### `ridgeline build [build-name]`

Execute the full build pipeline. For each phase: build, review, retry on
failure, advance on success. Automatically resumes from the last successful
phase if previous state exists.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | `opus` | Model for builder and reviewer |
| `--timeout <minutes>` | `120` | Max duration per phase |
| `--check-timeout <seconds>` | `1200` | Max duration for check command |
| `--max-retries <n>` | `2` | Max retry loops per phase |
| `--check <command>` | from constraints | Baseline check command (overrides constraints.md) |
| `--max-budget-usd <n>` | none | Halt if cumulative cost exceeds this amount |
| `--constraints <path>` | auto | Path to constraints file |
| `--taste <path>` | auto | Path to taste file |
| `--context <text>` | none | Extra context appended to builder and planner prompts |
| `--unsafe` | off | Disable sandbox (skip auto-detected Greywall/bwrap) |

```sh
ridgeline build my-feature
```

### `ridgeline rewind <build-name>`

Reset pipeline state to a given stage and delete downstream artifacts.

| Flag | Default | Description |
|------|---------|-------------|
| `--to <stage>` | (required) | Stage to rewind to: `shape`, `spec`, `research`, `refine`, or `plan` |

```sh
ridgeline rewind my-feature --to spec
```

### `ridgeline clean`

Remove stale git worktrees left behind by failed or interrupted builds.
Ridgeline creates a dedicated worktree for each build phase; worktrees from
successful builds are cleaned up automatically. Failed builds leave the
worktree in place so you can inspect the state before discarding it.

```sh
ridgeline clean
```

## Common Workflows

**Full workflow from scratch:**

```sh
ridgeline shape my-feature "Build a task management API"
ridgeline spec my-feature
ridgeline research my-feature --deep  # optional: enrich spec with web research
ridgeline refine my-feature           # optional: merge research into spec
ridgeline plan my-feature
ridgeline dry-run my-feature    # preview before committing
ridgeline build my-feature
```

**Auto-advance (runs the next incomplete stage each time):**

```sh
ridgeline my-feature "Build a task management API"
ridgeline my-feature   # continues from where it left off
```

**Use an existing document as input:**

```sh
ridgeline shape my-feature ./detailed-spec.md
ridgeline build my-feature
```

**Resume after failure:**

```sh
# Fix the issue manually or edit the phase spec, then re-run.
# Ridgeline picks up from the last successful phase and resets retry counts.
ridgeline build my-feature
```

**Budget-capped build:**

```sh
ridgeline build my-feature --max-budget-usd 10
```

**Unsafe build (sandbox disabled):**

```sh
# Sandbox is on by default when Greywall or bwrap is detected.
# Use --unsafe to opt out.
ridgeline build my-feature --unsafe
```

**Clean up stale worktrees:**

```sh
ridgeline clean
```
