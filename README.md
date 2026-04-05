# Ridgeline

Build harness for long-horizon software execution using AI agents.

Ridgeline decomposes large software ideas into phased builds using a
three-agent system (planner, builder, reviewer) driven by the Claude CLI. It
manages state through git checkpoints, tracks costs, and supports resumable
execution when things go wrong.

## How it works

1. **Write a spec** -- describe what you want built in a markdown file along
   with technical constraints and optional style preferences.
2. **Plan** -- the planner agent reads your spec and produces numbered phase
   files, each with its own scope and acceptance criteria.
3. **Build** -- for each phase the builder agent implements the spec inside your
   repo, then creates a git checkpoint.
4. **Review** -- the reviewer agent (read-only) checks the output against the
   acceptance criteria and returns a structured verdict. On failure, the harness
   generates a feedback file from the verdict for the builder's next attempt.
5. **Retry or advance** -- failed phases are retried up to a configurable limit;
   passing phases hand off context to the next one.

## Install

```sh
npm install -g ridgeline
```

Ridgeline requires the [Claude CLI](https://docs.anthropic.com/en/docs/claude-code)
to be installed and authenticated.

For sandboxing (recommended), install one of:

- **macOS/Linux:** [Greywall](https://github.com/GreyhavenHQ/greywall) --
  `brew install greywall` (domain-level network allowlisting + filesystem
  isolation)
- **Linux:** [bubblewrap](https://github.com/containers/bubblewrap) --
  `apt install bubblewrap` (full network block + read-only filesystem)

Sandboxing is on by default when a provider is detected. No flags needed.

## Quick start

```sh
# Scaffold a new build (interactive wizard)
ridgeline spec my-feature

# Or provide a description or existing spec document
ridgeline spec my-feature "Build a REST API for task management"
ridgeline spec my-feature ./my-spec.md

# Generate the phase plan
ridgeline plan my-feature

# Preview what will run
ridgeline dry-run my-feature

# Execute the full build
ridgeline build my-feature

# Resume after a failure (re-run build)
ridgeline build my-feature

# Clean up stale worktrees from failed builds
ridgeline clean
```

## Commands

### `ridgeline spec [build-name] [input]`

Creates the build directory under `.ridgeline/builds/<build-name>/` and collects
your spec, constraints, and optional taste file. Accepts an optional input
argument — a file path to an existing spec document or a natural language
description. If the input is detailed enough, the assistant skips or
pre-populates its clarification questions.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | `opus` | Model for spec assistant |
| `--timeout <minutes>` | `10` | Max duration per turn |

### `ridgeline plan [build-name]`

Invokes the planner agent to decompose the spec into numbered phase files
(`01-slug.md`, `02-slug.md`, ...) stored in the build's `phases/` directory.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | `opus` | Model for the planner |
| `--timeout <minutes>` | `120` | Max planning duration |
| `--constraints <path>` | auto | Path to constraints file |
| `--taste <path>` | auto | Path to taste file |

### `ridgeline dry-run [build-name]`

Displays the execution plan without invoking builders or reviewers. Accepts
the same flags as `plan`.

### `ridgeline build [build-name]`

Executes the full build pipeline: build each phase, evaluate, retry on failure,
and advance on success.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | `opus` | Model for builder and reviewer |
| `--timeout <minutes>` | `120` | Max duration per phase |
| `--check-timeout <seconds>` | `1200` | Max duration for check command |
| `--max-retries <n>` | `2` | Max reviewer retry loops per phase |
| `--check <command>` | from constraints | Baseline check command |
| `--max-budget-usd <n>` | none | Halt if cumulative cost exceeds this |
| `--constraints <path>` | auto | Path to constraints file |
| `--taste <path>` | auto | Path to taste file |
| `--unsafe` | off | Disable sandbox auto-detection |

The build command automatically resumes from the last successful phase if
previous state exists. Each build runs in an isolated git worktree -- completed
phases are reflected back to your branch, and failed builds leave the worktree
intact for inspection.

### `ridgeline clean`

Removes all build worktrees under `.ridgeline/worktrees/` and their associated
WIP branches. Use this after inspecting a failed build.

## Build directory structure

```text
.ridgeline/
├── settings.json      # Optional project-level config (network allowlist, etc.)
├── worktrees/         # Git worktrees for active builds
│   └── <build-name>/  # Isolated working directory per build
└── builds/<build-name>/
    ├── spec.md            # What to build
    ├── constraints.md     # Technical constraints and check commands
    ├── taste.md           # Optional coding style preferences
    ├── phases/
    │   ├── 01-scaffold.md
    │   ├── 01-scaffold.feedback.md  # Generated by harness on review failure
    │   ├── 02-core.md
    │   └── ...
    ├── state.json         # Phase statuses, retries, timestamps, git tags
    ├── budget.json        # Per-invocation cost tracking
    ├── trajectory.jsonl   # Event log (plan/build/eval start/complete)
    └── handoff.md         # Context passed to the next phase
```

## Configuration resolution

Constraint and taste files are resolved in order:

1. CLI flag (`--constraints <path>`)
2. Build-level (`.ridgeline/builds/<build-name>/constraints.md`)
3. Project-level (`.ridgeline/constraints.md`)

Project-level settings (network allowlist, etc.) are loaded from
`.ridgeline/settings.json`. See [SECURITY.md](SECURITY.md) for details.

## Development

```sh
npm install
npm run build        # Compile TypeScript and copy agent prompts
npm run dev          # Watch mode
npm test             # Typecheck, lint, and run unit tests
npm run test:unit    # Unit tests only (vitest)
npm run test:e2e     # End-to-end tests
npm run test:watch   # Watch mode
npm run lint         # Run all linters (oxlint, markdownlint, agnix, fallow)
npm run typecheck    # Type-check without emitting
```

## License

[MIT](LICENSE)
