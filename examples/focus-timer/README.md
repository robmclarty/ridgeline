# Focus Timer Example

A detailed `idea.md` for a Pomodoro SPA — written deliberately to exercise
ridgeline's full pipeline (including the visual / design path) from a single
input file, with no Q&A.

## What this example demonstrates

- **One-shot ingest from a single spec doc** — `idea.md` is detailed enough
  that the shaper, designer, and specifier can run non-interactively and
  still produce a coherent build kickoff.
- **Visual auto-chain** — the spec mentions "frontend / SPA / responsive /
  CSS" so the `web-visual` shape matches and `runShapeOneShot` auto-chains
  to `runDesignOneShot`. `design.md` is generated alongside `shape.md`,
  `spec.md`, `constraints.md`, and `taste.md`.
- **Inferred-vs-source visibility** — every output file gets an
  `## Inferred / Gaps` section listing what the agent guessed. Edit those
  by hand before running `plan` to patch holes.

## What this example does NOT trigger

- **Directions stage.** The visual-direction-advisor (which generates 2-3
  HTML demos in different aesthetic schools for you to pick from) is opt-in
  and is **not** part of `ingest` or the default auto-advance. To use it,
  run `ridgeline directions focus-timer` after `ingest` and before `plan`.
- **Plan and build.** `ingest` stops after writing the four (or five) input
  files. You run `plan` and `build` explicitly so you can review and edit
  the generated specs first.
- **Visual reviewer specialist.** This *does* run, but only inside `build`,
  when a phase touches files like `*.tsx`, `*.css`, `*.svg`, etc. The
  reviewer agent dispatches it automatically — nothing to configure.

## One-shot end-to-end command (from this directory)

```bash
# 1. Kickoff: shape + design (auto-chained) + spec from idea.md, no Q&A
node ../../dist/cli.js ingest focus-timer ./idea.md

# 2. (optional) Pick a visual direction before locking in design.md
#    Generates 2-3 self-contained HTML demos under
#    .ridgeline/builds/focus-timer/directions/. Open them in a browser, then
#    enter the picked id when prompted.
node ../../dist/cli.js directions focus-timer

# 3. Review & edit the generated files (especially "Inferred / Gaps" sections):
#      .ridgeline/builds/focus-timer/shape.md
#      .ridgeline/builds/focus-timer/design.md
#      .ridgeline/builds/focus-timer/spec.md
#      .ridgeline/builds/focus-timer/constraints.md
#      .ridgeline/builds/focus-timer/taste.md

# 4. Plan: generate phase specs
node ../../dist/cli.js plan focus-timer

# 5. (optional) Preview the plan before burning build budget
node ../../dist/cli.js dry-run focus-timer

# 6. Build: execute every phase, with retries and visual review on visual phases
node ../../dist/cli.js build focus-timer
```

If you've installed ridgeline globally (`npm install -g ridgeline`) you can
drop the `node ../../dist/cli.js` prefix and just use `ridgeline …`.

## Single-command "fire and forget" variant

If you trust the spec enough to skip the review-the-generated-files step,
you can chain ingest → plan → build in one shell line:

```bash
node ../../dist/cli.js ingest focus-timer ./idea.md \
  && node ../../dist/cli.js plan focus-timer \
  && node ../../dist/cli.js build focus-timer
```

This is the closest ridgeline gets to a true one-shot — but the
recommendation is still to review the generated `spec.md` and `design.md`
between `ingest` and `plan`, because edits there are far cheaper than
edits during `build`.

## How does this compare to the interactive workflow?

If you start from less than a full spec — say, just an idea like *"build me
a Pomodoro timer"* — use the interactive flow instead:

```bash
node ../../dist/cli.js focus-timer "Build a Pomodoro timer SPA"
```

The default command auto-advances one stage at a time:

- `shape` runs interactively (Q&A about scope, audience, tech preferences).
  Auto-chains to `design` if visual shapes match.
- `spec` runs the specifier ensemble non-interactively against `shape.md`.
- `plan` runs the planner ensemble.
- `build` executes every phase.

You re-invoke `ridgeline focus-timer` between stages, or run each stage
explicitly. Use `directions` and `research`/`refine` as opt-in extras
between stages.

The trade-off:

- **Detailed spec → ingest** — fast, no chat, but you must edit the
  `## Inferred / Gaps` sections to fix anything the agent guessed wrong.
- **Vague idea → interactive** — slower, more questions, but the agent
  pulls the spec out of you with shape and design Q&A and you don't need
  to write `idea.md` first.

Both paths converge on the same `plan → build` tail.
