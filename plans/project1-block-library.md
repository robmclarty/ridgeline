# Plan: Project 1 — Pipeline Building-Block Library

## What This Is

A library of reusable Mastra workflows and steps for AI agent pipelines. Each block is a self-contained unit with a typed input schema (its contract) and overlay slots (its steering surface). Blocks compose with other blocks using standard Mastra primitives — `.then()`, `.parallel()`, nested workflows. No custom abstraction layer.

Flavour/domain configuration flows through Mastra's `runtimeContext`, set once at the top level and inherited by all nested blocks.

## What This Is NOT

- Not a CLI tool (no terminal UI, no spinner, no output formatting)
- Not a framework or meta-layer on top of Mastra
- Not opinionated about what you build — these are intermediary building blocks, not goal-oriented workflows

## Core Principles

1. **Every block is a Mastra workflow or step.** No custom primitives. If Mastra can't express it, rethink the block.
2. **Input schemas are the contracts.** Each block declares what data it needs via Zod schemas. That's how blocks compose — output of one satisfies input of another.
3. **Runtime context carries configuration.** Flavour overlays, model preferences, tool configs — these are ambient, not per-block data. Set once, inherited everywhere.
4. **Prompt assembly is the only non-Mastra utility.** Base templates + overlay slots is a string-assembly function, not an orchestration layer.

## Architecture

### How Blocks Compose

```
Top-level workflow (set runtimeContext: flavour overlays, model, tools)
  │
  ├── shapeIntake (step)
  │     inputSchema: { intent, codebasePath }
  │     reads runtimeContext for: shaper overlay, model
  │     output: { shapeMd }
  │
  ├── ensembleSpec (workflow)
  │     inputSchema: { shapeMd }
  │     reads runtimeContext for: specifier overlays, specialist list, model
  │     │
  │     ├── .parallel([ specialistA, specialistB, specialistC ])
  │     └── .then(synthesizer)
  │     output: { specMd, constraintsMd, tasteMd }
  │
  ├── researchLoop (workflow)
  │     inputSchema: { specMd, constraintsMd }
  │     reads runtimeContext for: researcher overlays, iteration count
  │     │
  │     ├── .parallel([ academic, ecosystem, competitive, gaps ])
  │     └── .then(synthesizer)
  │     output: { researchMd }
  │
  └── ... etc
```

Every block reads `runtimeContext` for its configuration. The top-level consumer (a ridgeline workflow, a user's custom project) sets that context once.

### How Flavour Overlays Flow Down

```typescript
// Consumer sets context at execution time
const run = codeGenWorkflow.createRun();
await run.start(
  { intent: 'Build a platformer game', codebasePath: '/my/project' },
  {
    runtimeContext: {
      flavour: webGameFlavour,  // overlay files, model prefs, tool config
    },
  }
);

// Deep inside a nested block, the overlay is available:
execute: async ({ inputData, runtimeContext }) => {
  const flavour = runtimeContext.get('flavour');
  const systemPrompt = assemblePrompt('builder', flavour.overlays.builder);
  // ...
}
```

No special propagation mechanism. Mastra's runtimeContext inherits through nested workflows natively.

## Building Blocks

### Steps (atomic units)

Each step invokes a single agent with an assembled prompt.

#### `shapeIntake`
- **Purpose**: Interactive Q&A to extract project intent, scope, constraints
- **Input**: `{ intent: string, codebasePath: string }`
- **Output**: `{ shapeMd: string }`
- **Overlay slots**: `role`, `questions`, `extraction_focus`
- **Mode**: Interactive (requires user input via Mastra's suspend/resume or streaming)

#### `refine`
- **Purpose**: Merge research findings into an existing spec
- **Input**: `{ specMd: string, researchMd: string }`
- **Output**: `{ specMd: string, changelogMd: string }`
- **Overlay slots**: `role`, `merge_strategy`

#### `designIntake`
- **Purpose**: Interactive Q&A for visual/design decisions
- **Input**: `{ shapeMd: string }`
- **Output**: `{ designMd: string }`
- **Overlay slots**: `role`, `questions`, `design_dimensions`

#### `buildPhase`
- **Purpose**: Implement a single phase spec using an AI agent
- **Input**: `{ phaseSpec: string, constraintsMd: string, tasteMd?: string, designMd?: string, handoff: string }`
- **Output**: `{ handoffSection: string, success: boolean }`
- **Overlay slots**: `role`, `orient`, `build_strategy`, `verify`, `handoff`, `additional_inputs`, `build_constraints`

#### `reviewPhase`
- **Purpose**: Validate a completed phase against acceptance criteria
- **Input**: `{ phaseSpec: string, constraintsMd: string }`
- **Output**: `{ isPassed: boolean, feedback: string }`
- **Overlay slots**: `role`, `criteria_interpretation`, `evidence_requirements`

#### `specialist`
- **Purpose**: Generic specialist agent that produces a structured draft from a given perspective
- **Input**: `{ prompt: string, perspective: string }`
- **Output**: `{ draft: object }` (JSON matching a provided schema)
- **Overlay slots**: inherited from parent ensemble's runtimeContext

#### `synthesizer`
- **Purpose**: Generic synthesizer that merges multiple specialist drafts
- **Input**: `{ drafts: object[] }`
- **Output**: depends on context (spec.md, phases, research.md, etc.)
- **Overlay slots**: `role`, `synthesis_strategy`

### Workflows (composite units)

Each workflow composes steps and/or other workflows using Mastra primitives.

#### `ensemble`
- **Purpose**: Run N specialists in parallel, feed results to a synthesizer
- **Composition**: `.parallel([ specialist × N ]) .then(synthesizer)`
- **Input**: `{ prompt: string, specialistConfigs: SpecialistConfig[] }`
- **Output**: synthesizer's output (varies)
- **runtimeContext reads**: specialist overlay paths, synthesizer overlay, model, specialist schema
- **Options via runtimeContext**: `isTwoRound` (if true, adds annotation pass between specialist and synthesizer rounds)

#### `ensembleWithAnnotation`
- **Purpose**: Two-round ensemble — specialists draft, then review each other, then synthesize
- **Composition**: `.parallel([ specialist × N ]) .then(annotationRound) .then(synthesizer)`
- **Input**: same as `ensemble`
- **Output**: same as `ensemble`
- **When to use**: deeper analysis where cross-specialist critique improves output (planning, complex specs)

#### `buildWithReview`
- **Purpose**: Build a single phase, review it, retry on failure
- **Composition**: `buildPhase .then(reviewPhase)` with retry loop (Mastra `.until()`)
- **Input**: `{ phaseSpec, constraintsMd, tasteMd?, designMd?, handoff, maxRetries }`
- **Output**: `{ handoffSection, success, attempts }`

#### `buildAllPhases`
- **Purpose**: Execute all phases sequentially with handoff accumulation
- **Composition**: iterates `buildWithReview` for each phase, accumulating handoff state
- **Input**: `{ phases: PhaseSpec[], constraintsMd, tasteMd?, designMd? }`
- **Output**: `{ handoff: string, success: boolean, phaseResults: PhaseResult[] }`

#### `researchLoop`
- **Purpose**: Run research ensemble, optionally iterate multiple times
- **Composition**: `ensemble` wrapped in a loop (Mastra `.until()` or `.while()`)
- **Input**: `{ specMd, constraintsMd, maxIterations? }`
- **Output**: `{ researchMd: string }`

## Prompt Assembly Engine

The one non-Mastra utility. A pure function:

```typescript
function assemblePrompt(baseName: string, overlayPath?: string): string
```

- Reads a base template from the library's bundled `prompts/` directory
- If `overlayPath` provided, reads the overlay file (from the consumer's project, not the library)
- Injects `## section` blocks from the overlay into `{{OVERLAY:slot}}` markers in the base
- Returns the assembled string
- Empty/missing slots are silently removed (clean output)

### Base Templates

The library ships with base templates for each agent role:

```
prompts/
  builder.base.md       # structural skeleton for implementation agents
  planner.base.md       # structural skeleton for phase-planning agents
  reviewer.base.md      # structural skeleton for review/validation agents
  refiner.base.md       # structural skeleton for spec-refinement agents
  researcher.base.md    # structural skeleton for research agents
  shaper.base.md        # structural skeleton for intake/Q&A agents
  specifier.base.md     # structural skeleton for specification agents
  designer.base.md      # structural skeleton for design/visual agents
  specialist.base.md    # structural skeleton for ensemble specialists
  synthesizer.base.md   # structural skeleton for ensemble synthesizers
```

These contain the process instructions, numbered steps, output format requirements — the plumbing. Overlay slots are where domain-specific steering goes.

### Overlay Format

Overlay files are plain markdown with `## section` headers matching slot names:

```markdown
## role
You are a browser game developer. You build interactive visual applications.

## build_strategy
Set up the game loop with `requestAnimationFrame`. Structure code around
scenes/states. Implement the rendering pipeline first, then game logic,
then UI/HUD.

## verify
Capture canvas screenshots to verify rendering. Check framerate meets
the target from constraints.md.
```

These live in the consumer's project, not in the library.

## Package Structure

```
@ridgeline/blocks/           # or whatever name
  src/
    steps/
      shape-intake.ts
      build-phase.ts
      review-phase.ts
      refine.ts
      design-intake.ts
      specialist.ts
      synthesizer.ts
    workflows/
      ensemble.ts
      ensemble-with-annotation.ts
      build-with-review.ts
      build-all-phases.ts
      research-loop.ts
    prompts/
      builder.base.md
      planner.base.md
      reviewer.base.md
      ... (all base templates)
    assemble.ts             # prompt assembly function
    types.ts                # shared types, schemas, FlavourConfig interface
    index.ts                # public API exports
  package.json
  tsconfig.json
```

## Implementation Phases

### Phase 1: Scaffold + Prompt Engine

1. Init new repo, configure TypeScript, ESLint
2. Add `@mastra/core` as dependency
3. Implement `assemblePrompt()` + `parseOverlayFile()`
4. Extract base templates from current ridgeline agent files (diff all flavours to find the common skeleton)
5. Unit test: base + overlay → correct output, base alone → clean generic output

### Phase 2: Atomic Steps

Implement each step as a Mastra `createStep()`:

1. `specialist` — generic perspective-driven draft producer
2. `synthesizer` — generic multi-draft merger
3. `shapeIntake` — interactive Q&A
4. `buildPhase` — single phase implementation
5. `reviewPhase` — acceptance criteria validation
6. `refine` — research → spec merge
7. `designIntake` — visual/design Q&A

For each step:
- Define Zod input/output schemas
- Read overlays from `runtimeContext.get('flavour')`
- Call `assemblePrompt()` to build system prompt
- Create Mastra Agent inline with assembled prompt
- Invoke agent and return typed output

Test each step in isolation with mock runtimeContext.

### Phase 3: Composite Workflows

Build workflows from the steps:

1. `ensemble` — `.parallel([ specialist × N ]).then(synthesizer)`
2. `ensembleWithAnnotation` — adds annotation round
3. `buildWithReview` — `buildPhase` + `reviewPhase` with `.until()` retry
4. `buildAllPhases` — iterates `buildWithReview` with handoff accumulation
5. `researchLoop` — `ensemble` in a `.while()` / `.until()` loop

For each workflow:
- Verify Mastra's `.parallel()`, `.then()`, `.until()` express the pattern without custom orchestration
- Test with 2-3 specialists to verify parallel execution and output collection
- Test nested composition (e.g., `researchLoop` uses `ensemble` internally)

### Phase 4: Integration Test with Real Overlays

1. Create a test overlay set (use web-game overlays extracted from current ridgeline)
2. Compose a full pipeline: `shapeIntake → ensemble(spec) → researchLoop → refine → ensemble(plan) → buildAllPhases`
3. Execute end-to-end with a simple intent
4. Verify: prompts assembled correctly, state flows between blocks, runtimeContext propagates, outputs are typed

### Phase 5: Package + Publish

1. Configure exports in `package.json` (ESM)
2. Bundle base prompt templates with the package
3. Export all steps, workflows, types, and `assemblePrompt` from `index.ts`
4. Write minimal README: what each block does, how to compose, how overlays work
5. Publish (or link locally for Project 2 development)

## Types

```typescript
// The interface consumers implement to configure agents
interface FlavourConfig {
  name: string;
  overlays: Record<string, string>;     // agentRole → path to overlay .md file
  models: Record<string, string>;       // agentRole → model name (optional overrides)
  tools: Record<string, ToolConfig>;    // toolName → install/config info
  config: Record<string, unknown>;      // arbitrary config (isDeepEnsemble, etc.)
}

// What a specialist needs to know
interface SpecialistConfig {
  name: string;
  perspective: string;          // e.g., "clarity", "completeness"
  overlayPath?: string;         // perspective-specific overlay
  schema?: z.ZodSchema;         // expected output shape
}

// Ensemble configuration
interface EnsembleConfig {
  specialists: SpecialistConfig[];
  synthesizerOverlay?: string;
  isTwoRound?: boolean;
}
```

## Open Questions

1. **Library name**: `@ridgeline/blocks`? Something independent of "ridgeline"?
2. **Mastra as peer dep or direct dep**: Should consumers bring their own Mastra version, or does the library pin one?
3. **Base template versioning**: When a base template changes, all consumers' overlays need to match the new slot names. Semver major bump? Migration guide?
4. **Interactive steps**: How does `shapeIntake` handle user Q&A? Mastra's suspend/resume? Streaming? This needs a spike.
