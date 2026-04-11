# Visual Tool Skills & Flavour Architecture

**Date:** 2026-04-11
**Status:** Draft
**Branch:** feat/visual-design-system

## Problem

Ridgeline's build and review phases lack structured access to visual verification tools. The current `plugin/web-visual/tools/*.md` files are markdown guidance injected into prompts — they aren't proper Claude skills, so Claude can't discover or activate them on its own. There's no organizational pattern for scaling tool support across domains.

Users building web UIs and browser-based games need their builder agents to produce visually correct output and their reviewer agents to assess visual quality — using agent-first CLI tools, not repurposed human tools.

## Goals

1. Establish the pattern for how ridgeline delivers domain-specific tool capabilities through Claude skills.
2. Ship working tool skills for web UI and web game development.
3. Create two new flavours (`web-ui`, `web-game`) and enhance `software-engineering` with visual awareness.
4. Simplify the pipeline by removing bespoke tool family injection — let Claude's skill system handle tool discovery.

## Architecture

Three orthogonal systems work together:

### Flavours (domain knowledge)

Selected by the user via `--flavour` or `settings.json`. Shape how agents think about the problem domain. Builder knows web-game patterns, reviewer knows what to look for, planner knows how to sequence the work.

### Tool skills (CLI adapters)

Claude Code skills in skills 2.0 format (`SKILL.md`). Each wraps a specific external CLI tool with instructions for how to use it. Live in `plugin/visual-tools/skills/`. Discovered automatically by Claude via the `--plugin-dir` flag that ridgeline already passes to the Claude CLI.

### Flavour recommendations (setup hints)

A `recommendedSkills` field in flavour config that says "for best results with this flavour, install these tools." Surfaced at project creation time as an informational check. Not enforced.

### How they connect at runtime

```
User selects flavour (e.g., web-game)
  → Flavour agents loaded (builder, reviewer, etc.)
  → Plugin dir passed to Claude CLI (--plugin-dir plugin/visual-tools)
  → Claude sees skill catalog (name + description for each skill)
  → Builder agent says "capture screenshots to verify rendering"
  → Claude matches against agent-browser skill description, activates it
  → Skill tells Claude: run `agent-browser open <url> && agent-browser screenshot --annotate`
  → If agent-browser isn't installed, Claude adapts and works without it
```

### Graceful degradation

Flavour agents are assertive — they say "capture screenshots at mobile, tablet, and desktop viewports," not "if you can capture screenshots." If the backing tool isn't installed, Claude recognizes it can't execute the skill and adapts on its own. No conditional language in agent prompts, no pipeline-level availability checks at build time.

## Plugin Structure

Replace `plugin/web-visual/` with `plugin/visual-tools/`:

```
plugin/
  visual-tools/
    plugin.json
    skills/
      agent-browser/
        SKILL.md
        references/
          viewports.md
      visual-diff/
        SKILL.md
      css-audit/
        SKILL.md
      a11y-audit/
        SKILL.md
      lighthouse/
        SKILL.md
      canvas-screenshot/
        SKILL.md
      shader-validate/
        SKILL.md
```

### SKILL.md format

Each skill follows the skills 2.0 spec (https://agentskills.io):

```markdown
---
name: agent-browser
description: Capture annotated browser screenshots with numbered element labels
  for visual verification. Use when building or reviewing web UIs, verifying
  responsive layouts, or checking visual output of canvas/WebGL content.
compatibility: Requires agent-browser CLI (npm i -g @anthropic-ai/agent-browser)
metadata:
  author: ridgeline
  version: "1.0"
---

# Agent Browser

## Capturing screenshots
Run `agent-browser open <url>` then `agent-browser screenshot --annotate` ...

## Verifying responsive layouts
Capture at standard viewports: ...
```

## Skill Inventory

Seven skills total:

### agent-browser
- **Backing tool:** [agent-browser](https://github.com/vercel-labs/agent-browser)
- **Used by:** web-ui, web-game, software-engineering
- **Purpose:** Agent-first browser automation. Annotated screenshots with numbered element labels, DOM snapshots. 93% less context than Playwright. The primary "eyes" for web output.

### visual-diff
- **Backing tool:** [pixelmatch](https://github.com/mapbox/pixelmatch)
- **Used by:** web-ui, web-game, software-engineering
- **Purpose:** Pixel-level screenshot comparison against reference images. Catches visual regressions.

### css-audit
- **Backing tool:** [Project Wallace CLI](https://www.projectwallace.com/)
- **Used by:** web-ui
- **Purpose:** CSS statistics — specificity distribution, unused rules, selector complexity, color/font usage. Catches CSS bloat and inconsistency.

### a11y-audit
- **Backing tool:** [axe-core](https://github.com/dequelabs/axe-core)
- **Used by:** web-ui
- **Purpose:** WCAG 2.1 AA compliance checks. Contrast ratios, ARIA usage, landmark structure, keyboard navigation.

### lighthouse
- **Backing tool:** [Lighthouse CLI](https://github.com/GoogleChrome/lighthouse)
- **Used by:** web-ui
- **Purpose:** Performance, accessibility, best practices, SEO audits. Quantitative quality scores.

### canvas-screenshot
- **Backing tool:** [agent-browser](https://github.com/vercel-labs/agent-browser) or headless Chrome
- **Used by:** web-game
- **Purpose:** Captures rendered canvas/WebGL frames. Handles requestAnimationFrame timing — waits for scene initialization and captures at a stable frame. Separate from agent-browser because the workflow differs (render loop awareness, frame stability).

### shader-validate
- **Backing tool:** [naga-cli](https://crates.io/crates/naga-cli)
- **Used by:** web-game
- **Purpose:** Validates GLSL/WGSL shaders compile cleanly. Cross-compiles between shader languages. Catches syntax errors and type mismatches before runtime. Chosen over glslangValidator for speed (30x faster), WGSL support, and single-binary simplicity.

### Tool choice rationale

- **agent-browser over Playwright MCP** — agent-first design, purpose-built for AI context efficiency.
- **naga over glslangValidator** — 30x faster, supports WGSL (WebGPU future), Rust-based single binary, handles cross-compilation.
- **canvas-screenshot as separate skill** — even though it may use agent-browser under the hood, the workflow (render loop timing, frame stability) is different enough to warrant its own skill.

## Flavours

### New: web-ui

Web application UI development. Builder knows semantic HTML, CSS architecture, responsive design, accessibility patterns. Reviewer checks visual quality, layout correctness, interactive states.

```
src/flavours/web-ui/
  core/
    builder.md
    reviewer.md
  planners/          ← override only where needed
  specifiers/        ← override only where needed
```

Flavour config:
```json
{
  "name": "web-ui",
  "recommendedSkills": [
    "agent-browser",
    "visual-diff",
    "css-audit",
    "a11y-audit",
    "lighthouse"
  ]
}
```

Builder agent is assertive about visual verification: "Capture screenshots at 375px, 768px, and 1440px viewports. Run a CSS audit to check for unused rules and specificity issues. Run accessibility checks against WCAG 2.1 AA."

Reviewer checks responsive behavior, color contrast, typography hierarchy, spacing consistency, interactive states (hover, focus, active, disabled), loading/empty/error states.

### New: web-game

Browser-based interactive and visual projects — PixiJS, Phaser, Three.js, raw canvas, or React apps with heavy visual/interactive elements. Builder knows game loops, state machines, sprite management, canvas/WebGL rendering, performance budgets. Reviewer checks frame rate, visual consistency, input handling, asset loading.

```
src/flavours/web-game/
  core/
    builder.md
    reviewer.md
  planners/
  specifiers/
```

Flavour config:
```json
{
  "name": "web-game",
  "recommendedSkills": [
    "agent-browser",
    "visual-diff",
    "canvas-screenshot",
    "shader-validate"
  ]
}
```

Builder agent: "Capture a canvas screenshot after the scene initializes. Validate all shaders compile cleanly. Run a visual diff against the reference frame if one exists."

Reviewer checks rendering correctness, asset dimensions, color palette consistency, HUD legibility, input responsiveness, performance budgets.

### Enhanced: software-engineering

The default flavour. Updated to be visually aware when the project involves user-facing interfaces, without leading with visual concerns.

Flavour config adds:
```json
{
  "name": "software-engineering",
  "recommendedSkills": [
    "agent-browser",
    "visual-diff"
  ]
}
```

Builder and reviewer agents updated to include visual awareness: "If this feature has a user-facing interface, capture screenshots to verify the output." Visuals are part of the review, not the focus.

### Flavour agent prompt style

Flavour agents are direct and assertive about tool usage. They do not hedge with conditional language like "if you can capture screenshots." They state what should be done. Claude handles degradation naturally — if a skill's backing tool isn't available, Claude adapts without the agent prompt needing to account for it.

### Only override what's needed

Each flavour only provides agent files where the domain genuinely needs different behavior from the default. If the default shaper, specifier, planner, designer, researcher, or refiner works fine, don't override it. The `core/builder.md` and `core/reviewer.md` are the primary overrides for all three flavours since they're where tool usage and visual quality assessment happen.

## Pipeline Changes

### What stays
- **Shape definitions** (`src/shapes/*.json`) — still used for design intake questions and reviewer heuristics (high-level domain guidance like "check responsive behavior at mobile/tablet/desktop").
- **`matchedShapes` in state** — still used by the design command and specifier ensemble.
- **Shape-specific reviewer context** — the high-level guidance about what to look for, injected by the pipeline. This is domain awareness, not tool instructions.

### What goes
- **`toolFamily` field** in shape definitions — skills are discovered by Claude, not injected by the pipeline.
- **`plugin/web-visual/tools/*.md`** — replaced by proper skills in `plugin/visual-tools/skills/`.
- **Pipeline code that reads tool family markdown** and injects it into prompts — Claude handles tool usage through skill activation now.

### What changes
- **Reviewer context injection** (`src/engine/pipeline/review.exec.ts`) — keeps domain heuristics but drops tool-specific instructions. The reviewer flavour agent + skills handle the tool side.
- **Flavour config schema** — gains `recommendedSkills: string[]` field.
- **Plugin discovery** — `plugin/visual-tools/` replaces `plugin/web-visual/`. Same discovery mechanism, new directory.

### Simplification

The pipeline does less bespoke tool wiring because Claude's skill system handles it natively. The pipeline focuses on what it's good at (orchestration, state, handoff) and lets Claude handle tool usage.

## User Experience

### Setup flow

At project creation, ridgeline checks which recommended skills have their backing tools installed and shows an informational summary:

```
$ ridgeline create my-web-app --flavour web-ui

  ┌─────────────────────────────────────────────┐
  │  Build: my-web-app                          │
  │  Flavour: web-ui                            │
  │                                             │
  │  Recommended tools for this flavour:        │
  │    ✓ agent-browser     (found)              │
  │    ✓ pixelmatch        (found)              │
  │    ✗ wallace-cli       (not found)          │
  │    ✓ axe-core          (found)              │
  │    ✗ lighthouse        (not found)          │
  │                                             │
  │  Install missing tools:                     │
  │    npm i -g @anthropic-ai/agent-browser     │
  │    npm i -g lighthouse                      │
  │                                             │
  │  These are optional — ridgeline works       │
  │  without them, but results improve with     │
  │  them installed.                            │
  └─────────────────────────────────────────────┘
```

### Key UX decisions

- **Check happens at create time**, not build time — gives the user a chance to install before starting work.
- **Shows install commands** for missing tools — no hunting through docs.
- **Never blocks** — missing tools are informational. The build proceeds regardless.
- **Uses the `compatibility` field** from each SKILL.md to derive the check command and install instructions.

### During build/review

No special UX. Claude activates skills as needed. If a tool is missing, Claude adapts silently. The user sees the same build output they'd normally see.

## Future Extensions

This pattern supports future domains without architectural changes:

- **`godot-game` flavour** — Godot-specific builder/reviewer agents. New skills: `godot-scene-validate`, `godot-export`, `sprite-sheet-audit`.
- **`mobile-app` flavour** — mobile-specific agents. New skills: `ios-simulator-screenshot`, `android-emulator-screenshot`.
- **Additional skills** — `perf-profile`, `bundle-analyze`, `font-audit`. Drop a SKILL.md in `plugin/visual-tools/skills/`, add the name to a flavour's `recommendedSkills`.

Adding a new domain is: create a flavour directory with builder + reviewer agents, create skill SKILL.md files for any new tools, add `recommendedSkills` to the flavour config. No pipeline changes needed.
