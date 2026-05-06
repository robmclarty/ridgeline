![Matterhorn](matterhorn.jpg)

# Ridgeline

Build harness for long-horizon software execution using AI agents.

Ridgeline decomposes large software ideas into phased builds using a
multi-agent pipeline (shaper, direction-advisor, designer, specifier,
researcher, refiner, planner, builder, reviewer) driven by the Claude CLI. It
manages state through git checkpoints, tracks costs, and supports resumable
execution when things go wrong.

## How it works

1. **Shape** -- describe what you want built. The shaper agent analyzes your
   codebase and asks clarifying questions to produce a structured `shape.md`.
2. **Directions** (optional, web-visual builds only) -- the
   direction-advisor agent generates 2-3 differentiated visual direction
   options as self-contained HTML demos under `directions/<NN>-<slug>/`. Each
   direction lives in a different visual school with a named reference work.
   You open the demos in a browser and pick one; the picked direction's
   `tokens.md` and `brief.md` seed the design Q&A.
3. **Design** (optional) -- the designer agent establishes a visual design
   system (`design.md`) through interactive Q&A. If reference imagery is
   named, the reference-finder pulls representative images into
   `references/<slug>/` and writes a `visual-anchors.md` the downstream
   stages read. Auto-runs the asset catalog if assets exist, and injects
   catalog context (detected style, palette, resolution) into the design
   conversation. Works at build level or project level.
4. **Specify** -- an ensemble of three specialist agents (completeness,
   clarity, pragmatism) drafts spec proposals, then a synthesizer merges
   them into `spec.md`, `constraints.md`, and optionally `taste.md`.
5. **Research** (optional) -- an ensemble of research specialists (academic,
   ecosystem, competitive) investigates the spec using web sources, then a
   synthesizer merges findings into `research.md`. A gap analysis agenda
   step runs before specialist dispatch to focus research on spec gaps.
   Findings accumulate across iterations rather than being overwritten. A
   `--quick` single-agent mode is also available. See
   [Research and Refine](docs/research.md).
6. **Refine** (optional) -- the refiner agent rewrites `spec.md`
   incorporating research findings and writes `spec.changelog.md`
   documenting what changed. Additive by default -- adds insights without
   removing user-authored content.
7. **Plan** -- an ensemble of three specialist planners (simplicity,
   thoroughness, velocity) proposes phase decompositions, then a
   synthesizer merges them into numbered phase files with acceptance
   criteria. An adversarial plan-reviewer audits the result and triggers a
   one-shot revision if issues are found.
8. **Build** -- for each phase the builder agent implements the spec inside
   your repo, then creates a git checkpoint.
9. **Review** -- the reviewer agent (read-only) checks the output against
   the acceptance criteria and returns a structured verdict. For phases
   that touch visual code, it dispatches the visual-reviewer specialist to
   score rendered output against taste fidelity, motion discipline,
   hierarchy, conventions, and anti-slop. On failure, the harness generates
   a feedback file from the verdict for the builder's next attempt.
10. **Retry or advance** -- failed phases are retried up to a configurable
    limit; passing phases hand off context to the next one.

For a one-shot kickoff from an existing PRD/RFC/design doc (no Q&A), see
the [`ingest`](#ridgeline-ingest-build-name-input) command.

## Install

```sh
npm install -g ridgeline
```

**Platform:** macOS and Linux. Windows is not supported.

Ridgeline requires the [Claude CLI](https://docs.anthropic.com/en/docs/claude-code)
to be installed and authenticated.

For sandboxing (recommended), install
[Greywall](https://github.com/GreyhavenHQ/greywall) on macOS or Linux:
`brew install greywall`. Provides domain-level network allowlisting and
filesystem isolation.

Sandboxing is on by default when Greywall is detected. The default mode is
`semi-locked`; pass `--sandbox=strict` for tighter isolation or
`--sandbox=off` to disable.

## Quick start

```sh
# Auto-advance through the pipeline (shape → directions? → design? → spec → plan → build)
ridgeline my-feature "Build a REST API for task management"

# Or run each stage individually
ridgeline shape my-feature "Build a REST API for task management"
ridgeline directions my-feature        # optional: pick a visual direction (web-visual only)
ridgeline design my-feature            # optional: establish visual design system
ridgeline spec my-feature
ridgeline research my-feature          # optional: enrich spec with web research
ridgeline refine my-feature            # optional: merge research into spec
ridgeline plan my-feature
ridgeline dry-run my-feature           # preview before committing
ridgeline build my-feature

# One-shot kickoff from an existing spec doc (no Q&A)
ridgeline ingest my-feature ./path/to/PRD.md

# Catalog media assets (images, audio, video, text)
ridgeline catalog my-feature --classify --describe

# Resume after a failure (re-run build)
ridgeline build my-feature

# Rewind to an earlier stage and redo from there
ridgeline rewind my-feature --to spec

# Open the localhost dashboard for a build
ridgeline ui my-feature

# Clean up stale worktrees from failed builds
ridgeline clean
```

## Commands

### `ridgeline [build-name] [input]` (default)

Auto-advances the build through the next incomplete pipeline stage
(shape → directions → design → spec → plan → build; directions, design,
research, and refine are opt-in). Accepts all flags from the individual
commands.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for all stages |
| `--timeout <minutes>` | `10` | Max duration per turn |
| `--max-budget-usd <n>` | none | Halt if cumulative cost exceeds this |
| `--max-retries <n>` | `2` | Max reviewer retry loops per phase |
| `--check <command>` | from constraints | Baseline check command |
| `--check-timeout <seconds>` | `1200` | Max duration for check command |
| `--constraints <path>` | auto | Path to constraints file |
| `--taste <path>` | auto | Path to taste file |
| `--context <text>` | none | Extra context appended to builder and planner prompts |
| `--sandbox <mode>` | `semi-locked` | Sandbox mode: `off`, `semi-locked`, or `strict` |
| `--specialists <n>` | `3` | Ensemble specialists per stage (1, 2, or 3) |
| `--thorough` | -- | Alias for `--specialists 3` (the default) |
| `-y, --yes` | off | Skip the preflight confirmation prompt |

### `ridgeline shape [build-name] [input]`

Gathers project context through interactive Q&A and codebase analysis.
Produces `shape.md` in the build directory. Accepts an optional input
argument -- a file path to an existing document or a natural language
description.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for shaper agent |
| `--timeout <minutes>` | `10` | Max duration per turn |

### `ridgeline directions [build-name]`

Generates 2-3 differentiated visual direction options before the design
Q&A. Web-visual shapes only -- exits no-op for backend / non-visual builds
and warns/skips for game-visual / print-layout. Each direction lives in a
separate visual school (with a named reference work) under
`directions/<NN>-<slug>/`, containing `brief.md`, `tokens.md`, and a
`demo/index.html`. Open each demo in a browser, then enter the picked id
when prompted; the harness writes `directions/picked.txt` so the designer
agent can use it as seed context.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for direction-advisor agent |
| `--timeout <minutes>` | `15` | Max duration in minutes |
| `--count <n>` | from settings, else `2` | Number of directions to generate (2 or 3) |
| `--thorough` | -- | Alias for `--count 3` |
| `--skip` | -- | Explicit no-op (skip direction generation) |
| `-y, --yes` | off | Skip the preflight confirmation prompt |

Typical cost is $2-5 per run with opus.

### `ridgeline design [build-name]`

Establishes or updates a visual design system through interactive Q&A.
Produces `design.md` in the build directory (or project-level if no build
name is given). If an asset directory exists but no catalog has been
built, the catalog is auto-run and its summary (detected style, palette,
resolution, category breakdown) is injected into the designer's context.
If `directions/picked.txt` exists, the picked direction's tokens seed the
Q&A defaults; if `references/visual-anchors.md` exists, it is loaded as
additional context.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for designer agent |
| `--timeout <minutes>` | `10` | Max duration per turn |

### `ridgeline spec [build-name] [input]`

Runs the specifier ensemble: specialist agents (completeness, clarity,
pragmatism, plus visual-coherence for visual shapes) draft proposals in
parallel, then a synthesizer merges them into `spec.md`, `constraints.md`,
and optionally `taste.md`. Optionally accepts an `input` argument -- a
path to a file (convention: `idea.md`) or raw text -- which the
synthesizer treats as authoritative source material to preserve alongside
`shape.md`.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for specifier agents |
| `--timeout <minutes>` | `10` | Max duration per turn |
| `--max-budget-usd <n>` | none | Halt if cumulative cost exceeds this |
| `--specialists <n>` | `3` | Number of specialists (1, 2, or 3) |
| `--thorough` | -- | Alias for `--specialists 3` (the default) |

### `ridgeline ingest [build-name] [input]`

One-shot non-interactive pipeline kickoff. Converts a freeform spec --
either a single file (PRD, RFC, design doc) or a directory of related
markdown/text files -- into `shape.md`, `spec.md`, `constraints.md`,
`taste.md`, plus `design.md` when visual shapes match, in a single run
with no Q&A. The synthesizer flags inferred facts in a `## Inferred /
Gaps` section per output file so you can patch holes by editing the
markdown rather than answering chat questions, before running `plan`.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for shaper, designer, and specifier |
| `--timeout <minutes>` | `10` | Max duration per turn |
| `--max-budget-usd <n>` | none | Halt if cumulative cost exceeds this |
| `--specialists <n>` | `3` | Number of specialists (1, 2, or 3) |

### `ridgeline research [build-name]`

Researches the spec using web sources. Produces `research.md` in the
build directory. Optional step between `spec` and `plan`. See
[Research and Refine](docs/research.md) for details.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for research agents |
| `--timeout <minutes>` | `15` | Max duration per agent |
| `--max-budget-usd <n>` | none | Halt if cumulative cost exceeds this |
| `--quick` | off | Run a single random specialist instead of the full ensemble |
| `--auto [iterations]` | off | Auto-loop: research + refine for N iterations (default 2) |
| `--specialists <n>` | `3` | Number of specialists (1, 2, or 3) |

### `ridgeline refine [build-name]`

Merges `research.md` findings into `spec.md`. Run after reviewing or
editing `research.md`.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for refiner agent |
| `--timeout <minutes>` | `10` | Max duration |

### `ridgeline plan [build-name]`

Runs the planner ensemble: three specialist planners (simplicity,
thoroughness, velocity) propose phase decompositions in parallel, then a
synthesizer merges them into numbered phase files (`01-slug.md`,
`02-slug.md`, ...) stored in the build's `phases/` directory. An
adversarial plan-reviewer audits the synthesized plan and triggers a
one-shot revision if it surfaces issues. Phase specs may declare a
`## Required Views` section (visual builds) and a `## Required Tools`
section (any build); the harness probes each before its phase runs.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for planner agents |
| `--timeout <minutes>` | `120` | Max planning duration |
| `--constraints <path>` | auto | Path to constraints file |
| `--taste <path>` | auto | Path to taste file |
| `--specialists <n>` | `3` | Number of specialists (1, 2, or 3) |

### `ridgeline dry-run [build-name]`

Displays the execution plan without invoking builders or reviewers.
Accepts the same flags as `plan`.

### `ridgeline build [build-name]`

Executes the full build pipeline: build each phase, evaluate, retry on
failure, and advance on success.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for builder and reviewer |
| `--timeout <minutes>` | `120` | Max duration per phase |
| `--check-timeout <seconds>` | `1200` | Max duration for check command |
| `--max-retries <n>` | `2` | Max reviewer retry loops per phase |
| `--check <command>` | from constraints | Baseline check command |
| `--max-budget-usd <n>` | none | Halt if cumulative cost exceeds this |
| `--constraints <path>` | auto | Path to constraints file |
| `--taste <path>` | auto | Path to taste file |
| `--context <text>` | none | Extra context appended to builder and planner prompts |
| `--sandbox <mode>` | `semi-locked` | Sandbox mode: `off`, `semi-locked`, or `strict` |
| `--no-structured-log` | off | Disable structured logging to `log.jsonl` |

The build command automatically resumes from the last successful phase if
previous state exists. Each build runs in an isolated git worktree --
completed phases are reflected back to your branch, and failed builds
leave the worktree intact for inspection.

### `ridgeline rewind <build-name>`

Resets pipeline state to a given stage and deletes downstream artifacts.

| Flag | Default | Description |
|------|---------|-------------|
| `--to <stage>` | (required) | Stage to rewind to: `shape`, `design`, `spec`, `research`, `refine`, or `plan` |

### `ridgeline catalog [build-name]`

Indexes media assets into `asset-catalog.json` -- a structured metadata
file that feeds into the design and build phases. Supports images, audio,
video, and text files. The catalog pipeline runs in tiers:

1. **Deterministic metadata** (always runs) -- scans the asset directory,
   extracts file metadata (size, hash, dimensions for images), detects
   spritesheets and tileable textures, infers category from directory
   structure and filename conventions (e.g., `characters/knight-walk.png`
   → category "characters", subject "knight", state "walk"). Computes
   project-wide visual identity aggregates (detected style, palette,
   resolution).
2. **Classification** (with `--classify`) -- assigns categories to
   uncategorized files. Filename heuristics run first (e.g., `bg_*` →
   backgrounds, `sfx_*` → sfx). Files that don't match any pattern fall
   through to AI classification using Claude vision for images or text
   prompts for other media types.
3. **Vision enrichment** (with `--describe`) -- uses Claude vision to add
   semantic descriptions, facing direction, pose, style tags, and
   animation type for image assets. Layout and UI assets are
   auto-described regardless of the flag.
4. **Sprite packing** (with `--pack`) -- groups image assets by category
   and packs them into 2048×2048 sprite atlases with PixiJS-compatible
   JSON metadata. Backgrounds and layout references are excluded.

The catalog is incremental -- unchanged files (by content hash) are
skipped on subsequent runs unless `--force` is set.

| Flag | Default | Description |
|------|---------|-------------|
| `--asset-dir <path>` | auto | Path to asset directory |
| `--classify` | off | AI-classify uncategorized files into categories |
| `--describe` | off | Add vision-based descriptions for all image assets |
| `--pack` | off | Generate sprite atlases after cataloging |
| `--batch` | off | Batch multiple images per vision call |
| `--force` | off | Re-process all assets ignoring content hash |
| `--model <name>` | from settings, else `opus` | Model for vision and classification |
| `--timeout <minutes>` | `5` | Max duration per AI call |

Asset directory is resolved in order: `--asset-dir` flag,
`.ridgeline/builds/<build-name>/assets/`, `.ridgeline/assets/`, or the
`assetDir` field in `settings.json`.

### `ridgeline retrospective [build-name]`

Analyzes a completed build and extracts learnings for future builds.
Reads the trajectory log, budget, state, and any feedback files, then
appends structured insights to `.ridgeline/learnings.md`. Future builds
automatically pick up these learnings if the file exists.

| Flag | Default | Description |
|------|---------|-------------|
| `--model <name>` | from settings, else `opus` | Model for retrospective agent |
| `--timeout <minutes>` | `10` | Max duration |

### `ridgeline ui [build-name]`

Opens a localhost dashboard for monitoring a build. If no build name is
given, the most recently active build is selected. Streams trajectory
events, budget, and phase status in real time.

| Flag | Default | Description |
|------|---------|-------------|
| `--port <number>` | `4411` | Port to bind (falls back to next free port if taken) |

### `ridgeline check`

Reports project prerequisites and tooling status.

### `ridgeline clean`

Removes all build worktrees under `.ridgeline/worktrees/` and their
associated WIP branches. Use this after inspecting a failed build.

## Build directory structure

```text
.ridgeline/
├── settings.json      # Optional project-level config (model, sandbox, network allowlist, etc.)
├── design.md          # Optional project-level visual design system
├── learnings.md       # Optional accumulated build learnings (from retrospective)
├── directions/        # Optional project-level visual direction options
├── worktrees/         # Git worktrees for active builds
│   └── <build-name>/  # Isolated working directory per build
└── builds/<build-name>/
    ├── shape.md           # Structured project context (from shaper)
    ├── design.md          # Optional visual design system (from designer)
    ├── spec.md            # What to build
    ├── constraints.md     # Technical constraints and check commands
    ├── taste.md           # Optional coding style preferences
    ├── research.md        # Optional research findings (from researcher)
    ├── spec.changelog.md  # Optional changelog of spec refinements
    ├── asset-catalog.json # Optional indexed media assets (from catalog)
    ├── directions/        # Optional visual direction options (from direction-advisor)
    │   ├── 01-<slug>/
    │   │   ├── brief.md
    │   │   ├── tokens.md
    │   │   └── demo/index.html
    │   ├── 02-<slug>/
    │   └── picked.txt          # The id of the user-picked direction
    ├── references/        # Optional reference imagery (from reference-finder)
    │   ├── <slug>/             # Downloaded image files
    │   └── visual-anchors.md   # Per-anchor descriptions for downstream stages
    ├── phases/
    │   ├── 01-scaffold.md
    │   ├── 01-scaffold.feedback.md  # Generated by harness on review failure
    │   ├── 02-core.md
    │   └── ...
    ├── state.json         # Phase statuses, retries, timestamps, git tags
    ├── budget.json        # Per-invocation cost tracking
    ├── trajectory.jsonl   # Event log (plan/build/eval start/complete)
    ├── log.jsonl          # Optional structured log
    └── handoff.md         # Context passed to the next phase
```

## Configuration resolution

Constraint and taste files are resolved in order:

1. CLI flag (`--constraints <path>`)
2. Build-level (`.ridgeline/builds/<build-name>/constraints.md`)
3. Project-level (`.ridgeline/constraints.md`)

Project-level settings (default model, sandbox extras, directions count,
specialist count, network allowlist, etc.) are loaded from
`.ridgeline/settings.json`. See [SECURITY.md](SECURITY.md) for details
on the sandbox model.

## Development

```sh
npm install
npm run build         # Compile TypeScript and copy agent prompts
npm run dev           # Watch mode
npm run check         # Single command for the full quality pipeline
npm run check:bail    # Stop at the first failing step
npm run check:json    # Machine-readable summary on stdout (for agents)
npm run check:all     # Default checks plus stryker mutation testing
npm run test:unit     # Unit tests only (vitest)
npm run test:e2e      # End-to-end tests
npm run test:watch    # Watch mode
```

`npm run check` is the canonical pre-commit gate. It runs eight checks
(typecheck, oxlint with type-aware tsgolint, ast-grep structural rules,
agnix agent metadata, fallow dead code / duplication / complexity,
markdownlint, cspell, and vitest), captures per-tool output to
`.check/`, and writes a normalized `summary.json` for agent ingestion.
See [docs/development-checks.md](docs/development-checks.md) for the
full breakdown, output schema, and how to add new structural rules or
words to the spell-check dictionary.

## License

[Apache 2.0](LICENSE)
