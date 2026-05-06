I drafted the design.md but need permission to write it. Since this is a non-visual CLI substrate migration (no UI, no graphical output, no print artifact), the document is intentionally minimal — it captures output-medium conventions (terminal text, file formats) and explicitly notes the matched visual shape categories don't apply.

Here is the content I'd like to write to `.ridgeline/builds/fascicle-migration/design.md`:

```markdown
# Design

No visual surface — this is a non-visual build. The fascicle-migration is an
internal substrate swap inside the ridgeline CLI: orchestration plumbing moves
into fascicle while every externally observable behavior (CLI flags, on-disk
file formats, terminal output, exit codes) must not change. The matched shape
categories (game-visual, print-layout, web-visual) were auto-attached but do
not apply — there is no UI, no rendered output, no graphical or print artifact
involved.

## Output medium

ASCII / terminal text only.

- TTY output goes to stdout/stderr from a Node.js CLI (ridgeline ...).
- On-disk artifacts are plain text: Markdown (phases/<id>.md, seed.md, handoff
  files), JSON (state.json, budget.json), and JSON Lines (trajectory.jsonl).
- No graphical UI is in scope. src/ui/* modules render to the terminal only
  and are explicitly KEEP — they are not redesigned.

## Conventions

### Terminal output

- Streaming model output flows through fascicle's claude_cli provider
  StreamChunk events; ridgeline's existing terminal display is preserved.
- Color / styling: must match what ridgeline emits today. No new ANSI styles,
  banners, or emoji.
- Exit codes preserved. SIGINT continues to exit with code 130 after
  fascicle's install_signal_handlers default takes over.

### File-format conventions

Hard tokens — must not change:
- state.json shape; new fields additive and optional.
- phases/<id>.md format.
- trajectory.jsonl path and existing event shapes (new event types may be
  added; existing types must not change).
- budget.json totals match what the previous implementation would have
  written.
- CLI flag set unchanged.

Soft guidance:
- Prefer routing new diagnostic events through ctx.trajectory.
- Lean toward terse, single-line status messages.

### Naming-convention boundary

- Fascicle imports stay snake_case (create_engine, model_call, run).
- Ridgeline-side identifiers stay camelCase with is/has/should prefixes.
- No alias re-exports that hide the boundary.

## What is explicitly NOT being designed

- No new UI, dashboard, viewer, or graphical surface.
- No redesign of fascicle-viewer.
- No new color palette, typography, iconography, or layout system.
- No print artifact, game asset, sprite, or HUD work.

## Inferred / Gaps

- "No emoji in CLI output" as a hard convention — inferred because: shape.md
  doesn't explicitly state it, but current output style and global rule imply
  it.
- "No new ANSI styles, glyphs, banners" as a hard convention — inferred
  because: shape.md mandates "visible behavior must not change" but doesn't
  enumerate terminal styling.
- "Lean toward terse, single-line status messages" as soft guidance —
  inferred because: shape.md doesn't directly characterize ridgeline's tone.
- Treating matched shape categories (game-visual, print-layout, web-visual)
  as not applicable — inferred because: shape.md describes a CLI substrate
  swap with no visual surface; the non-visual fallback path fits.
- Routing new diagnostic events through ctx.trajectory as a soft preference —
  inferred because: shape.md establishes ctx.trajectory as the canonical
  event channel but doesn't explicitly say new diagnostics should prefer it
  over stderr.
```

Approve the write and I'll save it to `.ridgeline/builds/fascicle-migration/design.md`.