# Plan: Refactor Flavours into Composable Layers

## Goal

Replace the 15-flavour fork model (346 near-duplicate files) with a composable layer system where each agent prompt is assembled from a shared structural skeleton plus domain-specific overlay sections. The overlay sections are not string interpolation — they're full prose blocks that can fundamentally alter agent behavior, not just inject vocabulary.

## Current Problem

- 15 flavours × 23 files each = 346 files
- ~80% of each agent file is identical structural scaffolding
- A pipeline-level change (e.g., adding a handoff format) requires editing all 15 copies
- Special-casing for tools/packages per flavour doesn't scale
- Overlays for specialists (clarity, velocity, etc.) are already thin — the core agents are the maintenance burden

## Design Principles

1. **DRY the plumbing, not the steering.** The numbered process steps, file-reading sequences, output format requirements — that's plumbing. The paragraphs about *how to think about the domain*, *what quality means*, *what to prioritize* — that's steering. Keep steering as full prose blocks, not template variables.

2. **Overlays can reshape behavior, not just add vocabulary.** A web-game overlay for the builder doesn't just add "canvas" and "WebGL" — it replaces "Build what the phase spec asks for" with a full paragraph about game loop setup, rendering pipeline ordering, and scene/state architecture. These are *behavioral redirections*, not word swaps.

3. **Flavours become thin config + a set of overlay files.** A flavour directory shrinks from 23 files to ~10 overlay files plus a manifest.

4. **Backward-compatible fallback.** If a flavour provides no overlay for a given agent, the base template renders with empty overlay slots (generic behavior). Custom flavour directories (user paths) still work.

## Architecture

### File Structure (After)

```
src/
  agents/
    base/                          # structural skeletons
      core/
        builder.base.md
        planner.base.md
        reviewer.base.md
        refiner.base.md
        researcher.base.md
        shaper.base.md
        specifier.base.md
        designer.base.md
        retrospective.base.md
      planners/
        context.md                 # shared preamble (unchanged)
        clarity.md                 # specialist overlay (unchanged — already thin)
        completeness.md
        pragmatism.md
        velocity.md
      specifiers/
        context.md
        clarity.md
        completeness.md
        pragmatism.md
      researchers/
        context.md
        academic.md
        competitive.md
        ecosystem.md
        gaps.md
      specialists/
        explorer.md
        verifier.md
        tester.md
        auditor.md
    
  flavours/
    software-engineering/
      flavour.json                 # manifest: name, skills, tools, overlay declarations
      overlays/
        builder.md                 # domain overlay for builder
        planner.md
        reviewer.md
        researcher.md
        specifier.md
    web-game/
      flavour.json
      overlays/
        builder.md                 # rich: game loops, rendering pipelines, scene architecture
        planner.md                 # rich: player-facing phase descriptions, framerate criteria
        reviewer.md                # rich: canvas verification, performance budgets
        researcher.md              # rich: browser compat, frame budgets, bundle size
        specifier.md               # rich: mechanical verifiability for interactive systems
        designer.md                # exists only for visual flavours
      specialists/                 # optional: flavour can override specialist files too
        visual-coherence.md
      researchers/                 # optional: flavour can override researcher overlays
        context.md                 # domain-specific shared research context
    novel-writing/
      flavour.json
      overlays/
        builder.md
        planner.md
        ...
```

### Base Template Format

Each `.base.md` file uses named overlay slots marked with `{{OVERLAY:slot_name}}` tags:

```markdown
---
name: builder
description: Implements a single phase spec
model: sonnet
---

# Builder

{{OVERLAY:role}}

You receive a single phase spec and implement it. You have full tool access.

## Inputs

You will be given:

1. **Phase spec** — what to build, acceptance criteria, spec references.
2. **constraints.md** — non-negotiable technical guardrails.
{{OVERLAY:additional_inputs}}
3. **taste.md** (optional) — coding style preferences.
4. **handoff.md** — accumulated state from prior phases.
5. **feedback file** (retry only) — reviewer feedback on what failed.

## Process

### 1. Orient
Read handoff.md. Then explore the actual codebase.
{{OVERLAY:orient}}

### 2. Build
{{OVERLAY:build_strategy}}

Do not implement work belonging to other phases. Do not add features not in your spec.
{{OVERLAY:build_constraints}}

### 3. Verify
Run the check command from constraints.md.
{{OVERLAY:verify}}

### 4. Handoff
Write your handoff section.
{{OVERLAY:handoff}}
```

### Overlay File Format

Each overlay file contains named sections that map to slots:

```markdown
---
name: web-game builder overlay
description: Behavioral overrides for game development builds
---

## role
You are a browser game developer. You build interactive visual applications — canvas, WebGL, game loops, and state management.

## additional_inputs
2b. **design.md** (optional) — art direction, color palette, asset dimensions, HUD style. Treat as hard constraints when present.
2c. **asset-catalog.json** (optional) — catalog of available image assets with dimensions, palettes, anchors, z-layers, spritesheet data. Read before writing any asset-loading or rendering code.

## orient
Check what scenes exist, what systems are wired up, what assets are loaded, what is playable. Identify the rendering approach (canvas 2D, WebGL, PixiJS, Phaser, Three.js, raw DOM). Assess design.md for art direction.

## build_strategy
Set up the game loop with `requestAnimationFrame`. Structure code around scenes/states. Implement the rendering pipeline first, then game logic, then UI/HUD. This is browser-based — use npm packages and web APIs, not engine CLIs.

This may include game mechanics, player controls, physics, collision systems, level design, UI/HUD elements, audio integration, shader code, particle effects, state machines, scoring, AI behaviors, camera systems, or asset loading.

## build_constraints
Do not refactor systems unless your phase requires it.

## verify
If this phase produces visual output, capture canvas screenshots to verify rendering matches expectations. Run a visual diff against reference images if they exist. Check framerate meets the target from constraints.md.

## handoff
Include what is now playable, what systems are wired up, and what the player can do.
```

### Manifest Format (flavour.json)

```json
{
  "name": "web-game",
  "description": "Browser-based games and interactive visual applications",
  "recommendedSkills": ["agent-browser", "visual-diff", "canvas-screenshot", "shader-validate"],
  "tools": {
    "install": [
      { "name": "canvas-screenshot", "command": "cargo install canvas-screenshot" },
      { "name": "shader-validate", "command": "cargo install shader-validate" }
    ],
    "check": ["canvas-screenshot", "shader-validate"]
  },
  "matchedShapes": ["game", "interactive", "canvas", "webgl", "animation"],
  "designPhaseRequired": true
}
```

### Assembly Engine

New module: `src/engine/discovery/prompt.assemble.ts`

```typescript
interface AssembledPrompt {
  frontmatter: Record<string, string>;
  content: string;
}

function assemblePrompt(
  baseTemplatePath: string,
  overlayPath: string | null
): AssembledPrompt {
  // 1. Read base template
  // 2. If overlay exists, parse its named sections
  // 3. For each {{OVERLAY:slot_name}} in template:
  //    - If overlay has matching section → inject it
  //    - Otherwise → remove the tag line (clean empty slot)
  // 4. Merge frontmatter (overlay frontmatter overrides base)
  // 5. Return assembled prompt
}
```

Key behaviors:
- Empty slots produce clean output (no leftover markers)
- Overlay sections can be multi-paragraph prose
- Frontmatter merge allows overlay to override model, description
- Assembly is deterministic and cacheable

### Updated Agent Registry

`agent.registry.ts` changes:

```typescript
class AgentRegistry {
  // Before: reads complete prompt files from flavour or default
  // After: assembles prompts from base + overlay

  getCorePrompt(agentName: string): string {
    const basePath = `agents/base/core/${agentName}.base.md`;
    const overlayPath = this.flavourPath
      ? `${this.flavourPath}/overlays/${agentName}.md`
      : null;
    return assemblePrompt(basePath, overlayPath).content;
  }

  // Specialists: check if flavour overrides the subfolder, else use default
  // (same logic as before — specialist overlays are already thin)
  getSpecialists(subfolder: string): Specialist[] {
    // Check flavour/{subfolder}/ first, fallback to agents/base/{subfolder}/
    // This part is structurally unchanged
  }
}
```

## Implementation Steps

### Phase 1: Create Base Templates

For each of the 9 core agents (`builder`, `planner`, `reviewer`, `refiner`, `researcher`, `shaper`, `specifier`, `designer`, `retrospective`):

1. Diff the software-engineering and web-game versions side by side
2. Also diff against 2-3 other flavours (novel-writing, data-analysis, security-audit) to identify the true structural skeleton
3. Extract the common skeleton into `agents/base/core/{agent}.base.md`
4. Mark divergence points with `{{OVERLAY:slot_name}}` tags
5. Choose slot names that describe the *behavioral dimension*, not the domain:
   - `role` — who the agent is
   - `orient` — what to look for when surveying the project
   - `build_strategy` — how to approach construction
   - `verify` — what counts as evidence of correctness
   - Not: `game_stuff`, `web_things`

**Validation**: For each base template, verify that assembling it with NO overlay produces a coherent generic prompt equivalent to the current default agents in `src/agents/core/`.

### Phase 2: Extract Overlays from Web-Game

Starting with web-game (the most complex flavour):

1. For each core agent, extract the divergent prose into overlay files under `flavours/web-game/overlays/`
2. Use the `## section_name` format matching the `{{OVERLAY:slot_name}}` tags
3. Preserve the full behavioral prose — don't summarize or compress
4. Verify: `assemblePrompt(base, web-game-overlay)` should produce output identical (or functionally equivalent) to the current `flavours/web-game/core/{agent}.md`

**Important**: Some overlays will be substantial multi-paragraph blocks. That's correct. The designer overlay for web-game will be large because it's fundamentally a different agent role. The builder overlay will have detailed game-loop construction guidance. Don't fight this — the goal is DRY plumbing, not DRY steering.

### Phase 3: Build the Assembly Engine

1. Create `src/engine/discovery/prompt.assemble.ts`:
   - `parseOverlayFile(content: string): Record<string, string>` — parse `## section` blocks
   - `assemblePrompt(basePath, overlayPath): AssembledPrompt` — read, merge, clean
2. Add unit tests:
   - Base with no overlay → clean generic prompt
   - Base with full overlay → all slots filled
   - Base with partial overlay → filled slots + clean empty slots
   - Frontmatter merge precedence
3. Handle edge cases:
   - Overlay has a section that doesn't match any slot → warn (typo detection)
   - Base has slot with no match → silent removal (not all flavours need all slots)

### Phase 4: Update Agent Registry

1. Modify `agent.registry.ts` to use `assemblePrompt()` for core agents
2. Keep specialist/researcher/specifier loading unchanged (they're already thin overlays on a shared context)
3. Maintain the subfolder-level fallback logic for specialists: if flavour provides `researchers/`, use all of it
4. Add: if flavour provides `specialists/visual-coherence.md` or similar individual files, merge those into the default specialist set (finer-grained override than replacing the whole subfolder)

### Phase 5: Extract Overlays for All Flavours

For each of the remaining 14 flavours:

1. Diff the flavour's core agents against the base templates
2. Extract divergent prose into overlay files
3. Verify assembly produces equivalent output
4. Delete the full agent copies from the flavour directory

Order by complexity (most divergent first to catch missing slots early):
1. web-game (done in Phase 2)
2. game-dev
3. novel-writing
4. screenwriting
5. music-composition
6. security-audit
7. data-analysis
8. machine-learning
9. mobile-app
10. web-ui
11. legal-drafting
12. technical-writing
13. translation
14. test-suite
15. software-engineering (likely thinnest overlays)

### Phase 6: Update Flavour Manifests

1. Expand `flavour.json` schema to include tool installation, matched shapes, design phase flag
2. Move any special-casing currently in pipeline code into the manifest
3. Validate all manifests against a JSON schema

### Phase 7: Cleanup and Verify

1. Delete the old `src/flavours/{name}/core/`, `planners/`, `specifiers/`, `researchers/`, `specialists/` directories (replaced by overlays + selective overrides)
2. Run `npm run lint`
3. Run full pipeline end-to-end with at least web-game and software-engineering flavours
4. Verify: `ridgeline check --flavour web-game` still reports correct skill requirements
5. Verify: custom flavour paths (`--flavour ./my-flavour/`) still work with the new structure

## Expected Outcome

**Before**: 346 files across 15 flavours, ~80% duplication
**After**: ~9 base templates + ~100 overlay files + 15 thin manifests ≈ 130 files

A pipeline-level change (e.g., adding a new input to all builders) requires editing 1 base template instead of 15 files. Domain-specific behavior stays fully expressive — the web-game builder overlay can be as long and detailed as it needs to be.

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Slot names don't capture all divergence points | Start with web-game (most complex) — if it fits, simpler flavours will too. Add slots iteratively. |
| Assembly engine bugs produce subtly wrong prompts | Diff assembled output against original files for every flavour before deleting originals |
| Custom user flavours break | User flavours can still provide complete agent files (bypass assembly) — check for `core/builder.md` before trying `overlays/builder.md` |
| Some flavours need structural changes, not just overlay content | Allow an overlay to mark a slot as `{{REPLACE_SECTION}}` to replace the entire surrounding section, not just inject into it |

## Out of Scope

- Changing the pipeline steps themselves (shape → spec → plan → build → review)
- Changing the ensemble mechanics
- Changing the CLI interface
- Adding new flavours
- UI/dashboard changes
