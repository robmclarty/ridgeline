# Focus Timer Example

A detailed `idea.md` for a Pomodoro SPA — written deliberately to exercise
ridgeline's full pipeline (including the visual / design path) from a single
input file, with no Q&A.

## Recommended path: `--auto` end-to-end (from this directory)

```bash
# Build name auto-derived from ./idea.md → "idea". Drives the whole
# pipeline: shape → design → spec → plan → build → retro → retro-refine.
node ../../dist/cli.js ./idea.md --auto

# Full power — opt-in research and parallel directions with inspiration:
node ../../dist/cli.js ./idea.md --auto \
  --research \
  --directions 4 \
  --inspiration ~/my-pics/
```

If you've installed ridgeline globally (`npm install -g ridgeline`) drop
the `node ../../dist/cli.js` prefix and use `ridgeline …`.

What `--auto` does on this example:

1. **shape (auto)** — produces `shape.md` non-interactively from `idea.md`.
2. **directions (auto, opt-in)** — when `--directions N` is set and a
   visual shape matched, dispatches N parallel `design-specialist`
   subagents and picks one against `--inspiration`. Falls back to an
   interactive prompt if the picker is uncertain.
3. **design (auto)** — always runs in `--auto`, even for non-visual
   builds. For this Pomodoro app, produces a full `design.md` keyed off
   the picked direction (or off shape.md if directions wasn't enabled).
4. **spec → constraints → taste** — specifier ensemble fills in the rest.
5. **research + refine (opt-in)** — when `--research [N]` is set, runs N
   research+refine iterations between spec and plan.
6. **plan → build** — phase decomposition then phased build with retries
   and visual review on visual phases.
7. **retrospective** — appends learnings to `.ridgeline/learnings.md` so
   future builds inherit them automatically.
8. **retro-refine** — writes `<build-dir>/refined-input.md`, a refined
   version of the original `idea.md` informed by what the build learned.
   Skip with `--no-refine`.

## Pause for a manual review of generated specs

If you'd rather inspect (and edit) the generated `## Inferred / Gaps`
sections before plan/build, halt the auto run early:

```bash
node ../../dist/cli.js ./idea.md --auto --stop-after spec

# Review & edit:
#   .ridgeline/builds/idea/shape.md
#   .ridgeline/builds/idea/design.md
#   .ridgeline/builds/idea/spec.md
#   .ridgeline/builds/idea/constraints.md
#   .ridgeline/builds/idea/taste.md

# Then resume:
node ../../dist/cli.js idea --auto
```

## Stage-at-a-time (interactive) path

If you want the full interactive Q&A flow — useful when starting from
less than a full spec:

```bash
node ../../dist/cli.js focus-timer "Build a Pomodoro timer SPA"
```

The default command (without `--auto`) advances one stage per
invocation. Re-invoke `ridgeline focus-timer` between stages, or run
each stage explicitly:

```bash
node ../../dist/cli.js shape focus-timer "Build a Pomodoro timer SPA"
node ../../dist/cli.js directions focus-timer       # optional, interactive
node ../../dist/cli.js design focus-timer
node ../../dist/cli.js spec focus-timer
node ../../dist/cli.js plan focus-timer
node ../../dist/cli.js build focus-timer
node ../../dist/cli.js retrospective focus-timer    # optional
node ../../dist/cli.js retro-refine focus-timer     # optional
```

## Trade-offs

- **`--auto` from a detailed input** — fast, unattended, with a refined
  doc waiting at the end for the next iteration. Cost: anything the
  agents inferred goes into the build before you can review it; the
  retro and `## Inferred / Gaps` sections surface those after the fact.
- **`--auto --stop-after spec`** — same auto kickoff, but pause for
  human review of the inferred specs before plan/build burn budget.
- **Vague idea → interactive** — slowest. Best when you don't have a
  full spec and want the shape/design Q&A to draw it out of you.

All three converge on the same `plan → build → retro → retro-refine`
tail. The `learnings.md` file accumulates across runs and is read
automatically by future builds, so iteration becomes cheaper over time.

## What's in this directory

- `idea.md` — the spec source. Hits the `web-visual` shape category so
  the auto pipeline runs the visual path.
- `README.md` — this file.

After you run `--auto`, you'll see:

- `.ridgeline/builds/idea/` (or `focus-timer/` if you used the explicit
  build name) — all generated artifacts.
- `.ridgeline/learnings.md` — accumulated learnings, read by future
  builds.
- `<build-dir>/refined-input.md` — refined `idea.md` ready for a re-run.
