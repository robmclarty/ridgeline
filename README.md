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
4. **Review** -- the reviewer agent checks the output against the acceptance
   criteria and returns a structured verdict.
5. **Retry or advance** -- failed phases are retried up to a configurable limit;
   passing phases hand off context to the next one.

## Install

```sh
npm install -g ridgeline
```

Ridgeline requires the [Claude CLI](https://docs.anthropic.com/en/docs/claude-code)
to be installed and authenticated.

## Quick start

```sh
# Scaffold a new build (interactive wizard)
ridgeline init my-feature

# Generate the phase plan
ridgeline plan my-feature

# Preview what will run
ridgeline dry-run my-feature

# Execute the full build
ridgeline run my-feature

# Resume after a failure
ridgeline resume my-feature
```

## Commands

### `ridgeline init [build-name]`

Interactive wizard that creates the build directory under
`.ridgeline/builds/<build-name>/` and collects your spec, constraints, and
optional taste file.

### `ridgeline plan [build-name]`

Invokes the planner agent to decompose the spec into numbered phase files
(`01-slug.md`, `02-slug.md`, ...) stored in the build's `phases/` directory.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | `opus` | Model for the planner |
| `--verbose` | off | Stream planner output to the terminal |
| `--timeout <minutes>` | `30` | Max planning duration |
| `--constraints <path>` | auto | Path to constraints file |
| `--taste <path>` | auto | Path to taste file |

### `ridgeline dry-run [build-name]`

Displays the execution plan without invoking builders or reviewers. Accepts
the same flags as `plan`.

### `ridgeline run [build-name]`

Executes the full build pipeline: build each phase, evaluate, retry on failure,
and advance on success.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | `opus` | Model for builder and reviewer |
| `--verbose` | off | Stream output to the terminal |
| `--timeout <minutes>` | `30` | Max duration per phase |
| `--max-retries <n>` | `2` | Max reviewer retry loops per phase |
| `--check <command>` | from constraints | Baseline check command |
| `--max-budget-usd <n>` | none | Halt if cumulative cost exceeds this |
| `--constraints <path>` | auto | Path to constraints file |
| `--taste <path>` | auto | Path to taste file |

### `ridgeline resume [build-name]`

Loads existing state and resumes from the next incomplete phase. Accepts the
same flags as `run`.

## Build directory structure

```
.ridgeline/builds/<build-name>/
├── spec.md            # What to build
├── constraints.md     # Technical constraints and check commands
├── taste.md           # Optional coding style preferences
├── phases/
│   ├── 01-scaffold.md
│   ├── 02-core.md
│   └── ...
├── state.json         # Phase statuses, retries, timestamps, git tags
├── budget.json        # Per-invocation cost tracking
├── trajectory.jsonl   # Event log (plan/build/eval start/complete)
├── snapshot.md        # Summary of latest phase output
└── handoff.md         # Context passed to the next phase
```

## Configuration resolution

Constraint and taste files are resolved in order:

1. CLI flag (`--constraints <path>`)
2. Build-level (`.ridgeline/builds/<build-name>/constraints.md`)
3. Project-level (`.ridgeline/constraints.md`)

## Development

```sh
npm install
npm run build       # Compile TypeScript and copy agent prompts
npm run dev         # Watch mode
npm test            # Run the test suite (vitest)
npm run test:watch  # Watch mode
npm run lint        # Run all linters (oxlint, markdownlint, agnix)
```

## License

[MIT](LICENSE)
