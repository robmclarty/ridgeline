# Command Reference

## Requirements

- **Claude CLI** -- installed and authenticated (`claude` must be on PATH)
- **Node.js** -- for running ridgeline itself
- **Git** -- the project directory must be a git repository
- **Greywall** (optional) -- for network allowlist and filesystem sandboxing on macOS/Linux (`brew install greywall`)

## Install

```sh
npm install -g ridgeline
```

## Commands

### Preflight

Every pipeline-entry command (default, `shape`, `directions`, `design`,
`spec`, `ingest`, `research`, `refine`, `plan`, `build`, `rewind`,
`retrospective`) runs a short preflight that scans the project, prints what
it detected, names the sensors it will enable, and prompts once before
running. Under a TTY the prompt reads
`Press Enter to continue, Ctrl+C to abort`; in CI (non-TTY) the prompt is
replaced with `(auto-proceeding in CI)` and the command continues.

```text
Detected   react, vite, design.md   →   enabling   Playwright, vision, pa11y, contrast

Ensemble   3 specialists   (default; use --specialists 1|2 to shrink)
Sandbox    semi-locked   (greywall)
Caching    on
  Press Enter to continue, Ctrl+C to abort
```

Three flags shape preflight behavior on every pipeline-entry command:

| Flag | Default | Description |
|------|---------|-------------|
| `--specialists <n>` | `3` | Dispatch 1, 2, or 3 specialists. Default is 3 (was 2 prior to 0.9.0). |
| `--thorough` | -- | Alias for `--specialists 3` (the default). Retained for back-compat. |
| `-y`, `--yes` | off | Skip the Enter-to-continue prompt (useful for scripts) |

See [Preflight, Detection, and Sensors](preflight-and-sensors.md) for the
detection rules, the four built-in sensors, and the `shape.md` `## Runtime`
convention. See [Sandboxing and Access Control](sandboxing-and-access-control.md)
for the sandbox modes and per-build escape hatches.

### `ridgeline [build-name] [input]` (default)

Auto-advance the build through the next incomplete pipeline stage
(shape → directions → design → spec → plan → build; directions, design,
research, and refine are opt-in). Accepts all flags from the individual
commands.

```sh
ridgeline my-feature "Build a REST API for task management"
```

### `ridgeline shape [build-name] [input]`

Gather project context through interactive Q&A and codebase analysis. Produces
`shape.md` in `.ridgeline/builds/<build-name>/`. The optional `input` argument
can be a file path to an existing document or a natural language description.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for shaper agent |
| `--timeout <minutes>` | `10` | Max duration per turn |

```sh
# Interactive mode
ridgeline shape my-feature

# From a description
ridgeline shape my-feature "Build a REST API for task management with JWT auth"

# From an existing document
ridgeline shape my-feature ./existing-spec.md
```

### `ridgeline directions [build-name]`

Generate 2-3 differentiated visual direction options as self-contained HTML
demos before design Q&A. Web-visual shapes only — exits no-op for backend
projects, warns/skips for game-visual / print-layout. Each direction lives
in a different visual school under `directions/<NN>-<slug>/` and contains
`brief.md`, `tokens.md`, and a browser-openable `demo/index.html`. Open
each demo, pick one, and the picked direction's tokens seed the
`ridgeline design` Q&A.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for direction-advisor |
| `--timeout <minutes>` | `15` | Max duration |
| `--count <n>` | from settings, else `2` | Number of directions (2 or 3) |
| `--thorough` | -- | Alias for `--count 3` |
| `--skip` | -- | Explicit no-op (useful in auto-advance to opt out) |

```sh
ridgeline directions my-feature              # default 2 directions
ridgeline directions my-feature --thorough   # 3 directions
ridgeline directions my-feature --skip       # explicit opt-out
```

See [Directions](directions.md) for the full flow.

### `ridgeline design [build-name]`

Establish or update a visual design system through interactive Q&A.
Produces `design.md` in the build directory (or project-level if no build
name is given). Reads any existing `directions/picked.txt` and
`references/visual-anchors.md` as seed context.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for designer agent |
| `--timeout <minutes>` | `10` | Max duration per turn |

```sh
ridgeline design my-feature      # build-level
ridgeline design                  # project-level (.ridgeline/design.md)
```

See [Design](design.md) for question tracks and the picked-direction /
visual-anchor integration.

### `ridgeline spec [build-name] [input]`

Run the specifier ensemble to produce `spec.md`, `constraints.md`, and
optionally `taste.md`. Specialist agents (completeness, clarity,
pragmatism, plus visual-coherence for visual shapes) draft proposals in
parallel, then a synthesizer merges them. The optional `input` argument
accepts a path to an authoritative source doc (convention: `idea.md`) or
raw text — the synthesizer preserves it alongside `shape.md`.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for specifier agents |
| `--timeout <minutes>` | `10` | Max duration per turn |
| `--max-budget-usd <n>` | none | Halt if cumulative cost exceeds this amount |
| `--specialists <n>` | `3` | Number of specialists (1, 2, or 3) |

```sh
ridgeline spec my-feature
ridgeline spec my-feature ./idea.md
```

### `ridgeline ingest [build-name] [input]`

One-shot non-interactive pipeline kickoff. Converts a single PRD/RFC/design
doc, or a directory of related markdown/text files, into `shape.md` +
`spec.md` + `constraints.md` + `taste.md` (plus `design.md` when visual
shapes match) with no Q&A. The synthesizer flags inferred facts in a
`## Inferred / Gaps` section per output file so you can patch holes by
editing markdown rather than answering chat questions.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for shaper, designer, specifier |
| `--timeout <minutes>` | `10` | Max duration per turn |
| `--max-budget-usd <n>` | none | Halt if cumulative cost exceeds this amount |
| `--specialists <n>` | `3` | Number of specialists (1, 2, or 3) |

```sh
ridgeline ingest my-feature ./PRD.md
ridgeline ingest my-feature ./docs/        # directory of related files
```

See [Ingest](ingest.md) for the flow and the gap-flagging conventions.

### `ridgeline research [build-name]`

Research the spec using web sources. Optional step between `spec` and `plan`.

| Flag | Default | Description |
|------|---------|-------------|
| `--quick` | off | Run a single random specialist instead of the full ensemble |
| `--auto [N]` | off | Auto-loop: research + refine for N iterations (default 2 if no number given) |
| `--model <name>` | from settings, else `opus` | Model for research agents |
| `--timeout <minutes>` | `15` | Max duration per agent |
| `--max-budget-usd <n>` | none | Halt if cumulative research cost exceeds this amount |
| `--specialists <n>` | `3` | Number of specialists (1, 2, or 3) |

```sh
ridgeline research my-feature               # Full ensemble (default, 3 specialists)
ridgeline research my-feature --quick       # Single specialist, faster
ridgeline research my-feature --specialists 2   # 2 specialists
ridgeline research my-feature --auto        # 2 auto iterations
ridgeline research my-feature --auto 5      # 5 auto iterations
```

### `ridgeline refine [build-name]`

Merge research.md findings into spec.md and write spec.changelog.md documenting
what changed. Run after reviewing/editing research.md.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for refiner agent |
| `--timeout <minutes>` | `10` | Max duration |

```sh
ridgeline refine my-feature
```

### `ridgeline plan [build-name]`

Run the planner ensemble to decompose the spec into numbered phase files
(`01-slug.md`, `02-slug.md`, ...) stored in the build's `phases/` directory.
Three specialist planners (simplicity, thoroughness, velocity) propose in
parallel, a synthesizer merges them, and an adversarial plan-reviewer
audits the result before phases are written. If the plan-reviewer finds
issues, a one-shot revision pass runs.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for planner agents |
| `--timeout <minutes>` | `120` | Max planning duration |
| `--constraints <path>` | auto | Path to constraints file |
| `--taste <path>` | auto | Path to taste file |
| `--specialists <n>` | `3` | Number of specialists (1, 2, or 3) |

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
| `--model <name>` | from settings, else `opus` | Model for builder and reviewer |
| `--timeout <minutes>` | `120` | Max duration per phase (or `unlimited` for a 24h catchall) |
| `--check-timeout <seconds>` | `1200` | Max duration for check command |
| `--max-retries <n>` | `2` | Max retry loops per phase |
| `--check <command>` | from constraints | Baseline check command (overrides constraints.md) |
| `--max-budget-usd <n>` | none | Halt if cumulative cost exceeds this amount |
| `--constraints <path>` | auto | Path to constraints file |
| `--taste <path>` | auto | Path to taste file |
| `--context <text>` | none | Extra context appended to builder and planner prompts |
| `--sandbox <mode>` | `semi-locked` | Sandbox mode: `off`, `semi-locked`, or `strict` |
| `--unsafe` | -- | Deprecated alias for `--sandbox=off` |
| `--require-phase-approval` | off | Pause between phases for explicit user confirmation |
| `--no-structured-log` | off | Disable structured logging to `log.jsonl` |

```sh
ridgeline build my-feature
ridgeline build my-feature --sandbox=strict          # tighter isolation
ridgeline build my-feature --sandbox=off             # opt out (formerly --unsafe)
ridgeline build my-feature --require-phase-approval  # step phases interactively
```

#### Stop controls

While a build is running in a TTY, two non-destructive ways to pause:

- **Press `q` (or `Ctrl-G`)** — graceful stop. The current phase finishes
  naturally (including any in-flight builder-loop continuations) and the
  orchestrator exits 0 at the next phase boundary. A second press within
  5 seconds escalates to `SIGINT` for "stop now."
- **`--require-phase-approval`** — pauses between phases and asks `Continue
  to phase N? [Y/n/q]` before advancing. Answer `n` (or `q`) to exit
  cleanly with state preserved.

Both paths use the existing `state.json` resume — the next `ridgeline
build <name>` invocation picks up at the next pending phase.

### `ridgeline rewind <build-name>`

Reset pipeline state to a given stage and delete downstream artifacts.

| Flag | Default | Description |
|------|---------|-------------|
| `--to <stage>` | (required) | Stage to rewind to: `shape`, `design`, `spec`, `research`, `refine`, or `plan` |

```sh
ridgeline rewind my-feature --to spec
```

### `ridgeline catalog [build-name]`

Index media assets into `asset-catalog.json`. Tier 1 metadata always runs;
add `--classify`, `--describe`, or `--pack` to enable richer tiers. See
[Catalog](catalog.md) for the full flag set.

```sh
ridgeline catalog my-feature --classify --describe
```

### `ridgeline retrospective [build-name]`

Analyze a completed build and append structured insights to
`.ridgeline/learnings.md`. Future builds automatically pick up the file
when present. See [Retrospective](retrospective.md) for the format.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for retrospective agent |
| `--timeout <minutes>` | `10` | Max duration |

### `ridgeline clean`

Remove stale git worktrees left behind by failed or interrupted builds.
Ridgeline creates a dedicated worktree for each build phase; worktrees from
successful builds are cleaned up automatically. Failed builds leave the
worktree in place so you can inspect the state before discarding it.

```sh
ridgeline clean
```

### `ridgeline ui [build-name]`

Open a localhost build-monitoring dashboard. Serves a fully offline
dark-mode page from `127.0.0.1` (default port 4411 with free-port fallback)
that live-updates over Server-Sent Events, falling back to 2 s polling on
disconnect. With no `build-name` argument, attaches to the most recently
modified build under `.ridgeline/builds/*`. The command prints the URL on
startup and continues running until you `Ctrl+C`.

| Flag | Default | Description |
|------|---------|-------------|
| `--port <number>` | `4411` | Port to bind (falls back to the next free port if taken) |

```sh
ridgeline ui                 # attaches to most recent build
ridgeline ui my-feature      # attaches to a named build
ridgeline ui --port 5050     # bind to an explicit port
```

See [Preflight, Detection, and Sensors](preflight-and-sensors.md#the-ridgeline-ui-dashboard)
for the dashboard's design and offline guarantees.

## Common Workflows

**Full workflow from scratch:**

```sh
ridgeline shape my-feature "Build a task management API"
ridgeline spec my-feature
ridgeline research my-feature         # optional: enrich spec with web research (default 2 specialists)
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

**Sandbox-disabled build (opt-out):**

```sh
# Sandbox is on by default when Greywall is detected.
# Use --sandbox=off (or the deprecated --unsafe alias) to opt out.
ridgeline build my-feature --sandbox=off
```

**Strict-sandbox build:**

```sh
# semi-locked is the default; use strict for tighter isolation.
ridgeline build my-feature --sandbox=strict
```

**Clean up stale worktrees:**

```sh
ridgeline clean
```
