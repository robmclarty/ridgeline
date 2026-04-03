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

### `ridgeline spec [build-name] [input]`

Scaffold build input files from a description or existing spec. Creates
`.ridgeline/builds/<build-name>/` with `spec.md`, `constraints.md`, and
optionally `taste.md`.

The optional `input` argument can be a file path to an existing spec document
or a natural language description. If the input is detailed enough, the
assistant skips or pre-populates its clarification questions.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | `opus` | Model for spec assistant |
| `--timeout <minutes>` | `10` | Max duration per turn |

```sh
# Interactive mode
ridgeline spec my-feature

# From a description
ridgeline spec my-feature "Build a REST API for task management with JWT auth"

# From an existing document
ridgeline spec my-feature ./existing-spec.md
```

### `ridgeline plan [build-name]`

Generate phase specs from `spec.md` and `constraints.md`. Invokes the planner
agent to decompose the spec into numbered phase files (`01-slug.md`,
`02-slug.md`, ...) stored in the build's `phases/` directory.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | `opus` | Model for the planner |
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
| `--unsafe` | off | Disable sandbox (skip auto-detected Greywall/bwrap) |

```sh
ridgeline build my-feature
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
ridgeline spec my-feature "Build a task management API"
ridgeline plan my-feature
ridgeline dry-run my-feature    # preview before committing
ridgeline build my-feature
```

**Quick start (build auto-plans if no phases exist):**

```sh
ridgeline spec my-feature
ridgeline build my-feature
```

**Use an existing spec document:**

```sh
ridgeline spec my-feature ./detailed-spec.md
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
