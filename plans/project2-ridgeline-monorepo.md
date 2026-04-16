# Plan: Project 2 — Ridgeline Workflow Monorepo

## What This Is

A monorepo of goal-oriented AI agent workflows. Each package is a complete workflow that uses building blocks from the block library (Project 1) to accomplish a specific outcome. Ridgeline is no longer a framework — it's a collection of curated workflows.

Each package is its own project: own dependencies, own tools, own overlays, own build pipeline. They share a CLI package and some abstract tools, but are otherwise independent. A "flavour" is just a package.

## What This Is NOT

- Not a framework or library (that's Project 1)
- Not a monolithic CLI with 15 modes
- Not a place for generic building blocks (those belong in Project 1)

## Structure

```
ridgeline/
  packages/
    cli/                          # shared CLI UX (spinner, output, phase display)
    tools/                        # shared abstract tools used by multiple workflows
    software-engineering/         # workflow: full code generation pipeline
    web-game/                     # workflow: game development pipeline
    web-ui/                       # workflow: web UI development pipeline
    # future:
    # novel-writing/
    # security-audit/
    # creative-writing/
    # data-analysis/
  package.json                    # workspace root
  turbo.json / nx.json            # monorepo task runner (optional)
```

### `packages/cli`

The shared terminal UX layer. Every workflow package depends on this.

```
packages/cli/
  src/
    spinner.ts            # cylon-eye bouncing bar animation
    output.ts             # printInfo, printWarn, printError, printPhase
    logger.ts             # structured logging to .jsonl
    budget.ts             # cost display and tracking
    phase-header.ts       # visual phase separators
    stream-display.ts     # real-time agent output display
    index.ts
  package.json            # deps: chalk, ora, etc.
```

This package knows nothing about Mastra. It exports functions that workflow packages call to display progress. Workflow packages wire Mastra's streaming/events to these display functions.

### `packages/tools`

Shared tools that multiple workflows use but are too specific for the block library.

```
packages/tools/
  src/
    visual-diff.ts        # compare screenshots
    agent-browser.ts      # headless browser for agent use
    index.ts
  package.json
```

### `packages/software-engineering`

The "default" ridgeline experience — full code generation pipeline.

```
packages/software-engineering/
  src/
    workflow.ts           # Mastra workflow: shape → spec → research → plan → build
    cli.ts                # CLI entry point: `ridgeline-se <build-name>`
    mastra.ts             # Mastra instance registration
  overlays/
    builder.md            # software engineering builder overlay
    planner.md
    reviewer.md
    researcher.md
    specifier.md
    shaper.md
  flavour.ts              # FlavourConfig for software engineering
  package.json            # deps: @ridgeline/blocks, @ridgeline/cli, @mastra/core
```

**`workflow.ts`**:
```typescript
import { createWorkflow } from '@mastra/core';
import {
  shapeIntake,
  ensemble,
  researchLoop,
  refine,
  buildAllPhases,
} from '@ridgeline/blocks';

export const softwareEngineeringWorkflow = createWorkflow({
  id: 'software-engineering',
  inputSchema: z.object({
    intent: z.string(),
    codebasePath: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    artifacts: z.record(z.string()),
  }),
})
  .then(shapeIntake)
  .then(specEnsemble)         // ensemble with 3 specifier specialists
  .then(researchLoop)
  .then(refine)
  .then(planEnsemble)         // ensemble with 4 planner specialists
  .then(buildAllPhases)
  .commit();
```

**`flavour.ts`**:
```typescript
import type { FlavourConfig } from '@ridgeline/blocks';

export const softwareEngineeringFlavour: FlavourConfig = {
  name: 'software-engineering',
  overlays: {
    builder: './overlays/builder.md',
    planner: './overlays/planner.md',
    reviewer: './overlays/reviewer.md',
    researcher: './overlays/researcher.md',
    specifier: './overlays/specifier.md',
    shaper: './overlays/shaper.md',
  },
  models: {},                    // use defaults
  tools: {},                     // no special tools
  config: {
    includeResearch: true,
    isDeepEnsemble: false,
  },
};
```

**`cli.ts`**:
```typescript
import { softwareEngineeringWorkflow } from './workflow';
import { softwareEngineeringFlavour } from './flavour';
import { createSpinner, printPhaseHeader } from '@ridgeline/cli';

// Wire Mastra execution to CLI display
const run = softwareEngineeringWorkflow.createRun();
const spinner = createSpinner();

// Execute with flavour in runtimeContext
await run.start(
  { intent: userIntent, codebasePath: process.cwd() },
  {
    runtimeContext: { flavour: softwareEngineeringFlavour },
  }
);
```

### `packages/web-game`

The most complex workflow — demonstrates how a domain-specific package diverges.

```
packages/web-game/
  src/
    workflow.ts           # Mastra workflow: shape → design → spec → research → plan → build
    cli.ts
    mastra.ts
  overlays/
    builder.md            # game loops, rendering pipelines, scene architecture
    planner.md            # player-facing phase descriptions, framerate criteria
    reviewer.md           # canvas verification, performance budgets
    researcher.md         # browser compat, frame budgets, bundle size
    specifier.md          # mechanical verifiability for interactive systems
    designer.md           # art direction, color palette, HUD style
    shaper.md
  flavour.ts
  package.json            # deps: + canvas-screenshot, shader-validate
```

**Key differences from software-engineering:**

1. **Workflow shape is different** — includes `designIntake` step that software-engineering skips:
```typescript
export const webGameWorkflow = createWorkflow({ ... })
  .then(shapeIntake)
  .then(designIntake)           // always runs for games
  .then(specEnsemble)           // 4 specialists (adds visual-coherence)
  .then(researchLoop)
  .then(refine)
  .then(planEnsemble)
  .then(buildAllPhases)
  .commit();
```

2. **Extra specialist** — spec ensemble includes a visual-coherence specialist
3. **Extra tools** — canvas-screenshot, shader-validate in package.json
4. **Richer overlays** — builder overlay has paragraphs about game loop construction, renderer ordering, scene/state architecture
5. **Own dependencies** — could depend on puppeteer, playwright, etc. without affecting other packages

### `packages/web-ui`

Similar to software-engineering but with visual concerns:

```
packages/web-ui/
  src/
    workflow.ts           # includes designIntake, visual-coherence
    cli.ts
    mastra.ts
  overlays/
    builder.md            # component architecture, responsive layout, accessibility
    designer.md           # design tokens, spacing, typography
    ...
  flavour.ts
  package.json            # deps: + visual-diff, agent-browser
```

## How a New Workflow Gets Created

Someone wants to make a "security-audit" workflow:

1. Create `packages/security-audit/`
2. Write `workflow.ts` — maybe it's just `shapeIntake → researchLoop → researchLoop → reportStep` (no build phase at all, research-heavy, custom report step)
3. Write overlays that steer the researchers toward vulnerability databases, CVE patterns, compliance frameworks
4. Write `flavour.ts` with model preferences (maybe opus for the research synthesizer)
5. Write `cli.ts` wiring Mastra execution to `@ridgeline/cli` display
6. Add to monorepo or keep as standalone project — either works

They import building blocks from `@ridgeline/blocks`, add their own custom steps if needed, and wire it all together. The block library doesn't know or care about security audits.

## Implementation Phases

### Phase 1: Monorepo Scaffold

1. Init new repo with workspace support (npm/pnpm workspaces or turborepo)
2. Create `packages/cli/`, `packages/tools/`, `packages/software-engineering/`
3. Set up shared TypeScript config, ESLint
4. Add `@ridgeline/blocks` as dependency (once Project 1 is published/linked)
5. Add `@mastra/core` as dependency

### Phase 2: Port CLI Package

Port from current ridgeline:

1. Spinner (cylon-eye bouncing bar + verb rotation)
2. Output functions (printInfo, printWarn, printError, printPhase, printPhaseHeader)
3. Structured logger (.jsonl output)
4. Budget display
5. Stream display (real-time agent output with spinner pause/resume)

This package has zero Mastra dependency. It's pure terminal UI.

Test: spinner renders, output functions produce correct formatting.

### Phase 3: Software Engineering Workflow

The first complete workflow. Port from current ridgeline:

1. Extract overlays from current `src/flavours/software-engineering/` agent files
2. Write `flavour.ts` config
3. Write `workflow.ts` composing blocks from Project 1
4. Write `cli.ts` wiring Mastra events to CLI display
5. End-to-end test: run the full pipeline with a simple intent, verify output matches current ridgeline quality

### Phase 4: Web Game Workflow

The stress test — most complex domain:

1. Extract overlays from current `src/flavours/web-game/` agent files
2. Write `flavour.ts` with extra tools, visual-coherence specialist, design-always-on
3. Write `workflow.ts` — different shape than software-engineering (includes designIntake)
4. Add canvas-screenshot, shader-validate as package deps
5. End-to-end test: verify game-specific prompts, design phase, visual tools all work

### Phase 5: Web UI Workflow

1. Extract overlays from current `src/flavours/web-ui/`
2. Write workflow — similar to web-game but with component/accessibility focus
3. Test

### Phase 6: Shared Tools

1. Port visual-diff tool
2. Port agent-browser tool
3. Any other tools used by multiple workflow packages
4. Wire into workflow packages that need them

### Phase 7: Validation

1. Run all three workflows end-to-end
2. Compare output quality to current ridgeline
3. Verify: no workflow package affects another (independent deps, independent execution)
4. Verify: adding a new workflow package requires zero changes to existing packages

## Migration Path

1. Project 1 (block library) must be built first — it's the foundation
2. This monorepo consumes it
3. Current ridgeline stays operational during development
4. Cut over per-workflow: software-engineering first, then web-game, then web-ui
5. Remaining 12 flavours migrate as needed (or don't — some may not be worth porting)

## Open Questions

1. **Monorepo tool**: turborepo vs nx vs plain pnpm workspaces?
2. **CLI unification**: One `ridgeline` command with subcommands (`ridgeline se build`, `ridgeline web-game build`), or separate binaries per package (`ridgeline-se`, `ridgeline-wg`)?
3. **Studio integration**: Each workflow package registers with Mastra's Studio independently? Or is there a top-level Mastra instance that aggregates all workflows for a unified Studio view?
4. **Overlay sharing**: Some overlays are nearly identical between web-game and web-ui (e.g., reviewer). Share via the tools package, or accept the small duplication?
