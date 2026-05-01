# Shapes and Detection

Ridgeline classifies builds by **shape** — the kind of visual surface the
project has, if any. Shape detection runs after `ridgeline shape` writes
`shape.md` and determines whether the optional visual stages
(`directions`, `design`) and the visual-reviewer specialist apply to this
build.

There are three shape categories today: `web-visual`, `game-visual`, and
`print-layout`. Builds that don't match any category are treated as
non-visual (backend, CLI, library, etc.) and skip every visual stage.

## Why Shapes Exist

Different visual surfaces need different treatment:

- A **web app** needs responsive breakpoints, interactive states, and
  WCAG contrast checks.
- A **game** needs sprite dimensions, palette consistency, and HUD
  legibility.
- A **printed document** needs bleed/trim areas, font embedding, and
  CMYK color values.
- A **backend service** needs none of these and shouldn't pay the cost of
  trying.

The shape category routes the build into the right design Q&A track and
gates whether visual review fires during build. Without shape detection,
either every build would pay the visual-stage cost or no build would get
visual review.

## How Detection Works

After the shaper writes `shape.md`, the dispatcher loads shape definitions
from `src/shapes/*.json`, lowercases the shape document, and matches each
definition's keywords against the text. A keyword match triggers the
shape — multiple shapes can match the same project.

```ts
// src/shapes/detect.ts (simplified)
export function detectShapes(text: string, definitions: ShapeDefinition[]) {
  const lower = text.toLowerCase()
  return definitions.filter(def =>
    def.keywords.some(keyword => lower.includes(keyword.toLowerCase()))
  )
}
```

The matched shape names are persisted to `state.json` under
`matchedShapes` and read by downstream commands:

- **`ridgeline directions`** runs only when a `web-visual` shape matched.
  Game-visual and print-layout warn and skip; non-visual exits with a
  message and no work.
- **`ridgeline design`** runs auto-chained from `shape` when any visual
  shape matched, asking visual-domain-appropriate questions.
- **The reviewer** dispatches the visual-reviewer specialist when the
  diff touches visual code, regardless of shape — but the screenshots
  the visual-reviewer reads are only captured when the playwright sensor
  fires, which itself depends on the project being a visual surface.

## The Three Shape Definitions

Shape definitions are JSON files under `src/shapes/`. Each defines a
name, keywords, and reviewer context.

### `web-visual`

```json
{
  "name": "web-visual",
  "keywords": [
    "UI", "frontend", "CSS", "responsive", "web app", "dashboard",
    "website", "landing page", "SPA", "component library", "design system",
    "Tailwind", "React", "Vue", "Svelte"
  ],
  "reviewerContext": "Check responsive behavior at mobile/tablet/desktop viewports. Verify interactive states. Evaluate whitespace and visual breathing room. Check color contrast ratios."
}
```

Triggers: web apps, dashboards, marketing sites, SPAs, component
libraries, anything with HTML/CSS/JS frontend code.

### `game-visual`

```json
{
  "name": "game-visual",
  "keywords": [
    "game", "sprite", "texture", "3D", "scene", "canvas",
    "WebGL", "Godot", "Unity", "Phaser"
  ],
  "reviewerContext": "Verify asset dimensions match specification. Check color palette consistency. Validate sprite sheet layouts. Evaluate UI overlay legibility against game backgrounds."
}
```

Triggers: anything game-related — sprite work, 3D scenes, game engines,
WebGL, asset-driven projects.

### `print-layout`

```json
{
  "name": "print-layout",
  "keywords": [
    "print", "PDF", "document", "brochure", "typography",
    "poster", "flyer", "report"
  ],
  "reviewerContext": "Verify bleed and trim areas. Check font embedding. Validate resolution meets print DPI requirements. Evaluate typographic hierarchy and spacing consistency."
}
```

Triggers: PDF documents, print collateral, reports, posters, anything
intended for physical output.

## What Each Shape Enables

| Shape | Directions | Design Q&A track | Visual review |
|-------|------------|------------------|---------------|
| `web-visual` | Yes (one-shot demos) | Web tracks: foundation, component patterns, accessibility | Yes |
| `game-visual` | Skipped (warns) | Game tracks: art direction, UI/HUD, asset integration | Yes (sprite/HUD focus) |
| `print-layout` | Skipped (warns) | Print tracks: document foundation, visual elements | Yes (bleed/font focus) |
| (none matched) | No-op | Skipped | Reviewer skips visual specialist |

The current implementation runs full direction-advisor only for
`web-visual` because the agent's prompt is calibrated to web-style
direction differentiation (visual schools, named reference works,
self-contained HTML demos). Adding game-visual and print-layout direction
support would mean teaching the agent to render game UI mockups or print
layouts — not a one-line change.

## Multiple Matches

A project can match multiple shapes. A web-based interactive game
("WebGL game in a React app") would match both `web-visual` and
`game-visual`. The designer reads all matched shape categories and
selects question tracks accordingly — for the WebGL-in-React case, it
would ask web-visual foundation questions plus game-visual asset
questions.

The `directions` command explicitly checks for `web-visual` membership
in the matched list before generating directions. A build that matched
both `game-visual` and `web-visual` would get directions; a build that
matched only `game-visual` would skip them.

## What Shape Detection Doesn't Do

- **Detection is keyword-based, not semantic.** A shape document that
  describes a backend service in terms that happen to include the word
  "responsive" (e.g., "responsive HTTP timeouts") will falsely match
  `web-visual`. The remedy is to refine the shape document, not the
  detector.
- **No confidence scoring.** A shape either matches or it doesn't. There
  is no "60% confident this is web-visual" — just a boolean.
- **No project-config override.** You can't pin a shape category in
  `settings.json`. If detection is wrong, edit `shape.md` to remove the
  triggering keywords or rewind to shape and re-author.

## Adding a New Shape

The shape system is intentionally small. To add a new shape (e.g.,
`mobile-app`):

1. Add `src/shapes/mobile-app.json` with `name`, `keywords`, and
   `reviewerContext`.
2. The shape will be matched automatically — `loadShapeDefinitions` reads
   every `.json` in the directory.
3. Update the designer agent's prompt (`src/agents/core/designer.md`) to
   add a question track for the new shape.
4. Update the visual-reviewer's prompt and any shape-specific dispatch
   logic (e.g., the `directions` command's web-visual check).

Steps 1-2 alone are enough for the designer to pick up the shape; the
remaining steps fine-tune downstream behavior.

## Where Shapes Are Read

The `state.json` `matchedShapes` array is the single source of truth.
Code that branches on shape:

- `src/commands/directions.ts` — gates direction-advisor on
  `web-visual` membership.
- `src/commands/shape.ts` — auto-chains to `design` when any visual
  shape matches.
- `src/commands/design.ts` — passes matched shapes to the designer's
  context for question-track selection.
- `src/agents/core/designer.md` — branches its question track on
  matched shape categories.
- `src/agents/specifiers/visual-coherence.md` — only runs when a visual
  shape is matched.

## Related Docs

- [Shaping](shaping.md) — produces the `shape.md` that detection reads.
- [Design](design.md) — consumes matched shapes to pick a question track.
- [Directions](directions.md) — gated on `web-visual` membership.
- [Visual Review](visual-review.md) — the downstream consumer of all
  shape-driven work.
