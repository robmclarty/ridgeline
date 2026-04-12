# Visual Design System for Ridgeline

**Date:** 2026-04-11
**Status:** Draft

## Overview

Extend Ridgeline with visual design awareness across the full pipeline — from shaping through review. Three interconnected systems compose to give Claude "design sense" without coupling Ridgeline to any specific toolchain or domain.

1. **Shape Detection Engine** — An extensible keyword-to-category registry that scans shape.md to detect visual concerns and activate the appropriate specialists and tools.
2. **Design Artifact Lifecycle** — A new `design.md` artifact (project-level and feature-level) that carries visual design system definitions through the pipeline, alongside constraints.md and taste.md.
3. **Visual Tool Families** — Plugin-based tool bundles (web-visual, game-visual, print-layout) that the reviewer uses for verification, with graceful degradation when tools aren't installed.

## Shape Detection Engine

### Purpose

After shaping completes, the harness analyzes shape.md against a registry of shape definitions to detect what categories of concern are present. Matched categories determine which specialists activate during specifying and which tool families the reviewer can use.

### Registry Structure

Shape definitions live in `src/shapes/` and ship with Ridgeline. Each is a JSON file:

```json
{
  "name": "web-visual",
  "keywords": ["UI", "frontend", "CSS", "responsive", "web app", "dashboard", "website", "landing page", "SPA", "component library", "design system", "Tailwind", "React", "Vue", "Svelte"],
  "toolFamily": "web-visual",
  "reviewerContext": "Check responsive behavior at mobile/tablet/desktop viewports. Verify interactive states. Evaluate whitespace and visual breathing room. Check color contrast ratios."
}
```

Fields:

- `name` — Identifier for this shape category.
- `keywords` — Strings to match against shape.md content (case-insensitive).
- `toolFamily` — Which tool family plugin to activate for the reviewer.
- `reviewerContext` — Domain-specific design heuristics injected into the reviewer prompt when this shape is active.

### Shipped Shape Definitions

| Shape | Keywords (sample) | Tool Family | Status |
|-------|-------------------|-------------|--------|
| `web-visual` | UI, frontend, CSS, responsive, dashboard, SPA, Tailwind | `web-visual` | Build now |
| `game-visual` | game, sprite, texture, 3D, scene, canvas, WebGL, Godot, Unity, Phaser | `game-visual` | Design now, build later |
| `print-layout` | print, PDF, document, brochure, typography, poster, flyer, report | `print-layout` | Design now, build later |

### Detection Flow

1. After `ridgeline shape` completes and shape.md is written, the harness scans shape.md against all definitions in `src/shapes/`.
2. Matching is case-insensitive keyword presence in shape.md content. Multiple categories can match (e.g., a web game matches both `web-visual` and `game-visual`).
3. Matched shape names are recorded in build state (state.json) so downstream stages can read them.
4. If any visual shape matched → the harness automatically chains into the `ridgeline design` command.
5. If no shapes matched → pipeline continues as today with no overhead.

### Extensibility

- Drop a new `.json` file in `src/shapes/` → new category works without code changes.
- Project-level overrides: `.ridgeline/shapes/` could override or extend shipped definitions (future consideration).
- Categories are data, not code. Adding game-visual or print-layout support later is configuration + plugin creation, not pipeline modification.

## Design Artifact Lifecycle

### The `ridgeline design` Command

A new command that produces design.md through interactive design-focused shaping. It reuses the shaper agent pattern but with a design-specialized prompt.

**Entry points:**

- **Auto-chained from shape:** When shape detection finds visual concerns, the design command runs automatically within the build context, producing feature-level design.md at `builds/<build>/design.md`. The user experiences a seamless flow: shaping questions → design questions → done with both shape.md and design.md.
- **Standalone:** `ridgeline design` can be run independently to establish or update a project-level design system (`.ridgeline/design.md`) at any time, outside of any build context.

**Behavior:**

1. Check for existing design.md at both levels (project and build).
2. If found: read as starting context. Offer to refine, extend, or use as-is.
3. If not found: ask design-focused questions informed by the matched shape categories.
4. For `web-visual` matches: ask about color palette, typography scale, spacing grid, component patterns, responsive breakpoints, accessibility requirements.
5. For `game-visual` matches: ask about art style, asset dimensions, color palettes, UI overlay conventions, HUD layout.
6. Produce design.md as freeform markdown with both hard tokens and soft guidance.

### design.md Format

**No enforced schema.** The design.md is freeform markdown. The design command produces well-structured output as a starting point, but users can edit, rewrite, or create it entirely by hand. Valid design.md documents include:

- A formal style guide with hex codes, font stacks, spacing scales
- Informal notes: "keep it minimal, lots of whitespace, muted earth tones"
- Example definitions: h1-h6 with sizes, grid columns, component patterns
- A brand guidelines document copy-pasted from elsewhere
- Any mix of the above

**Binding levels within design.md** are interpreted from language, not structure:

- **Hard tokens** (non-negotiable): Signaled by specificity and imperative language — exact hex codes, pixel values, "must use", "always", "never", "required". Violation is a blocking issue in review.
- **Soft guidance** (best-effort): Signaled by directional language — "prefer", "lean toward", "something like", "generally". Deviation is a suggestion in review, not a failure.

### Two Levels of design.md

- **Project-level:** `.ridgeline/design.md` — Persistent brand/design system. Created by `ridgeline design` run standalone or promoted from a build. Inherited by all builds.
- **Feature-level:** `.ridgeline/builds/<build>/design.md` — Feature-specific visual concerns. Created when `shape` chains into `design` for a specific build.

**Resolution (same pattern as constraints.md):**

1. Check `buildDir/design.md` (feature-specific).
2. Fall back to `ridgelineDir/design.md` (project-level).
3. Both can coexist — both are injected as separate labeled sections (`## Project Design` and `## Feature Design`). Agents interpret precedence naturally: feature-level design extends or overrides project-level where they conflict.

**Auto-detection:** The system checks both locations regardless of how design.md was created. If a user manually creates `.ridgeline/design.md` before ever running `ridgeline design`, the specifier discovers and uses it. The command is a convenience, not a gate.

### Pipeline Consumption

| Stage | Receives design.md | How It Uses It |
|-------|-------------------|----------------|
| Specifier (visual specialist) | Project + feature design.md | Informs visual acceptance criteria on spec features |
| Planner | design.md | Considers design constraints when decomposing phases |
| Builder | design.md | Hard tokens = mandatory (like constraints), soft guidance = best-effort (like taste). Deviations noted in handoff.md |
| Reviewer | design.md + tool family context | Hard token violations = blocking. Soft guidance deviations = suggestions |

### Injection Mechanism

Extend `appendConstraintsAndTaste()` in `pipeline.shared.ts` (or create a parallel function) to inject design.md into agent prompts:

```text
## design.md

{contents of design.md}
```

Injected for: planner, builder, reviewer. The specifier receives it through the ensemble specialist prompt assembly instead.

## Visual Specialist in the Specifier Ensemble

### Conditional Activation

The specifier pipeline checks the matched shapes from the shaping step (stored in build state). If any visual shape was matched, the visual specialist joins the ensemble — 4 specialists instead of 3. If no visual shapes matched, the standard 3-specialist ensemble runs with no overhead.

### The Visual Coherence Specialist

**Perspective:** Evaluates the proposed spec through the lens of visual design concerns.

**Receives:**

- shape.md (same as other specialists)
- Project-level design.md (if exists)
- Feature-level design.md (if exists)
- Matched shape categories (for context on what domain of visual concerns apply)

**Produces:** The same `SpecifierDraft` structure as other specialists, with emphasis on:

- Visual acceptance criteria on features (e.g., "dashboard uses the 8px spacing grid", "color contrast meets WCAG AA")
- Implicit visual requirements the shape didn't call out (e.g., responsive layout, loading states, empty states)
- Design-specific constraint suggestions (check commands for visual verification)
- Identification of where design.md hard tokens apply to specific features

**Schema extension** — `SpecifierDraft` gains an optional field:

```typescript
design?: {
  hardTokens?: string[]
  softGuidance?: string[]
  featureVisuals?: {
    feature: string
    criteria: string[]
  }[]
} | null
```

Only the visual specialist populates this. Other specialists leave it null.

### Synthesizer Changes

The specifier synthesizer (specifier.md) needs updated instructions to:

- Recognize and merge the visual specialist's proposals alongside the other three perspectives.
- Fold visual acceptance criteria into each feature's criteria list in spec.md.
- Merge design-specific constraints into constraints.md.
- Handle the case where the visual specialist proposes additions to design.md itself (discovered during specifying).

## Visual Tool Families

### Architecture

Each tool family is a Ridgeline plugin containing agent prompts that wrap CLI tool invocations. Tools are peer dependencies — the user installs them if they want them. If a tool isn't available, the reviewer skips that check gracefully.

### Plugin Structure

```text
plugin/
  web-visual/
    plugin.json
    tools/
      screenshot.md      → Playwright: render, capture at viewports
      css-audit.md        → Project Wallace: CSS statistics analysis
      a11y-audit.md       → axe-core / pa11y: accessibility checks
      visual-diff.md      → pixelmatch: compare against reference images
      lighthouse.md       → Lighthouse: performance + a11y + best practices
```

### Graceful Degradation

Each tool agent follows this pattern:

1. Check if the underlying CLI tool is available (e.g., `npx playwright --version`).
2. If available → run it, return structured results.
3. If unavailable → report "skipped: [tool] not installed" and move on.

The reviewer aggregates whatever results it gets. Fewer tools means a less thorough visual review, not a failure. The reviewer's verdict notes what was checked and what was skipped.

**Degradation levels:**

- Nothing installed → prompt-only design review against design.md (still valuable)
- Playwright only → screenshot capture + multimodal AI evaluation
- Full suite → screenshots + CSS audit + accessibility + visual diff + lighthouse

### Reviewer Verification Pipeline

When the reviewer runs for a phase with visual concerns, it executes available tools in order:

1. **Code review against design.md** — Always runs. Evaluates CSS/HTML/component code against design document tokens and guidance.
2. **Screenshot capture** (Playwright) — Render built output at key viewports. Screenshots become multimodal input for Claude's visual evaluation.
3. **Multimodal design evaluation** — Claude sees screenshots alongside design.md. Evaluates visual hierarchy, spacing consistency, color harmony, design token adherence.
4. **CSS audit** (Project Wallace) — Machine-readable statistics: unique colors, font sizes, spacing values. Detects design system drift and near-duplicate values.
5. **Accessibility check** (axe-core) — WCAG violations with severity levels. Color contrast failures, missing ARIA, semantic issues.
6. **Lighthouse audit** — Accessibility, performance, best practices scores. Supplements axe-core with broader quality signals.
7. **Visual diff** (pixelmatch) — Only when reference images exist. Compares rendered output against references, reports mismatch percentage.

### Verdict Integration

The reviewer's existing verdict structure accommodates visual-specific entries naturally:

- Hard token violations → `severity: "blocking"` (review fails, same as constraint violations)
- Soft guidance deviations → `severity: "suggestion"`
- Tool results (a11y violations, CSS drift) → mapped to blocking or suggestion based on severity
- Skipped tools → noted in verdict, never blocking

### Recommended Peer Dependencies

Documented in Ridgeline docs, not enforced:

```text
Web Visual:   npm i -D playwright @axe-core/cli @projectwallace/css-analyzer lighthouse pixelmatch
Game Visual:  npm i -D sharp   (+ engine-specific tools)
Print Layout: npm i -D pdfjs-dist fontkit sharp
```

### Tool Family Roadmap

| Family | Tools | Status |
|--------|-------|--------|
| **web-visual** | Playwright screenshots, pixelmatch diffs, Project Wallace CSS analyzer, axe-core accessibility, Lighthouse audits | Build now |
| **game-visual** | Asset dimension validator (sharp), color palette checker, sprite sheet validator, canvas/WebGL screenshot capture, scene graph extraction | Design now, build later |
| **print-layout** | PDF layout analysis (pdfjs-dist), font validator (fontkit), resolution/DPI checker (sharp), bleed/trim validation | Design now, build later |
| **3d-visual** | Model format validator, texture resolution checker, material consistency, render preview capture | Future |

**Adding a new tool family requires:**

1. Create shape definition: `src/shapes/<name>.json` with keywords and tool family.
2. Create plugin: `plugin/<name>/` with tool agent prompts.
3. Add reviewer context with domain-specific design heuristics.
4. No core pipeline code changes.

## Implementation Scope

### Build Now

- Shape detection engine (`src/shapes/`, detection logic, state recording)
- `ridgeline design` command (design-focused shaper, design.md creation)
- Auto-chaining from shape → design when visual concerns detected
- design.md resolution, injection into pipeline (config, pipeline.shared.ts)
- Visual Coherence specialist for specifier ensemble
- Specifier synthesizer updates to merge visual proposals
- Reviewer prompt enhancements for design.md evaluation
- `web-visual` tool family plugin (Playwright, axe-core, Project Wallace, Lighthouse, pixelmatch)
- Shape definitions: `web-visual.json`
- Reviewer graceful degradation logic
- Documentation: recommended peer dependencies per tool family

### Design Now, Build Later

- `game-visual` shape definition and tool family plugin
- `print-layout` shape definition and tool family plugin
- Flavour-specific visual reviewer agent overlays (game-dev, etc.)

### Future

- `3d-visual` shape definition and tool family
- Project-level shape overrides (`.ridgeline/shapes/`)
- Visual diff reference image management in specs
- Design.md version tracking and evolution across builds
