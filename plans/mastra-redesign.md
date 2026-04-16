# Plan: From-Scratch Redesign Using Mastra

## Vision

A system where users compose AI agent pipelines from building blocks — like Mindustry/Factorio conveyor belts for AI workflows. Pipelines are defined as structured config (a DSL), not code. "Flavours" become input files that configure which blocks connect, what agents think about, and what tools are available. Long-term: a visual node-graph UI to wire it all up and monitor execution in real-time.

## Why Mastra

Mastra (v1.24.1 @mastra/core, v1.5.0 CLI) provides:

- **Workflow DAGs** with `.then()`, `.parallel()`, `.branch()` composition — maps directly to our pipeline steps
- **First-class state management** between steps with typed schemas (replaces our handoff.md threading)
- **Agent abstraction** with tools, subagents, streaming, and dynamic system prompts
- **Studio UI** — built-in visual dashboard for agents/workflows (foundation for the Factorio UI)
- **MCP integration** — tool installation/dependencies handled via protocol, not per-flavour special-casing
- **Runtime context injection** — flavour config can flow into any step without hardcoding
- **Suspend/resume** — workflows can pause and resume (replaces our state.json checkpoint system)
- **Hono-based server** — REST API for all agents/workflows out of the box (enables future web UI)

## Core Concept: Pipeline-as-Config

### The DSL

A pipeline is defined in a YAML/JSON file that declares steps, their connections, agent configurations, and tool requirements:

```yaml
# pipelines/code-generation.pipeline.yaml
name: code-generation
description: Full code generation pipeline with research and review
version: 1

input:
  schema:
    intent: { type: string, required: true }
    codebasePath: { type: string, required: true }
    constraints: { type: string }

steps:
  shape:
    agent: shaper
    mode: interactive        # requires user input
    outputs: [shape.md]

  design:
    agent: designer
    mode: interactive
    condition: "input.needsDesign == true"
    outputs: [design.md]

  spec:
    ensemble:
      specialists: [clarity-specifier, completeness-specifier, pragmatism-specifier]
      synthesizer: specifier
      twoRound: false
    inputs: [shape.md]
    outputs: [spec.md, constraints.md, taste.md]

  research:
    ensemble:
      specialists: [academic-researcher, ecosystem-researcher, competitive-researcher, gaps-researcher]
      synthesizer: researcher
    inputs: [spec.md, constraints.md]
    outputs: [research.md]
    repeatable: true          # can run multiple iterations
    condition: "config.includeResearch != false"

  refine:
    agent: refiner
    inputs: [spec.md, research.md]
    outputs: [spec.md]        # overwrites
    condition: "steps.research.completed"

  plan:
    ensemble:
      specialists: [clarity-planner, completeness-planner, pragmatism-planner, velocity-planner]
      synthesizer: planner
      twoRound: "config.deepEnsemble == true"
    inputs: [spec.md, constraints.md, taste.md]
    outputs: [phases/*.md]

  build:
    agent: builder
    mode: sequential-phases   # iterates over phases/*.md
    inputs: [phases/*.md, constraints.md, taste.md, design.md, handoff.md]
    outputs: [handoff.md, code]
    review:
      agent: reviewer
      maxRetries: 3

output:
  artifacts: [code, spec.md, phases/*.md, handoff.md, research.md]
```

### Agent Definitions

Agents are defined as composable config + prompt files:

```yaml
# agents/builder.agent.yaml
name: builder
description: Implements a single phase spec
model: sonnet
promptFile: prompts/builder.base.md    # structural skeleton

tools:
  required: [read, write, bash, glob, grep]
  optional: []

overlays:                               # domain overlays applied at runtime
  accepts: [role, orient, build_strategy, verify, handoff, additional_inputs, build_constraints]
```

### Flavour = Config Bundle

A flavour is just a directory of overlay files + a manifest:

```yaml
# flavours/web-game/flavour.yaml
name: web-game
description: Browser-based games and interactive visual applications
extends: code-generation              # which pipeline to use

skills:
  required: [canvas-screenshot, shader-validate]
  recommended: [agent-browser, visual-diff]

tools:
  - name: canvas-screenshot
    install: "cargo install canvas-screenshot"
  - name: shader-validate
    install: "cargo install shader-validate"

overrides:
  steps:
    design:
      condition: "true"               # always run design for games
    spec:
      ensemble:
        specialists:
          - clarity-specifier
          - completeness-specifier
          - pragmatism-specifier
          - visual-coherence-specifier  # add a 4th specialist

  agents:
    builder:
      overlayFile: overlays/builder.md
      model: opus                      # games need more capable model
    planner:
      overlayFile: overlays/planner.md
    reviewer:
      overlayFile: overlays/reviewer.md
    researcher:
      overlayFile: overlays/researcher.md
    specifier:
      overlayFile: overlays/specifier.md
    designer:
      overlayFile: overlays/designer.md

config:
  includeResearch: true
  deepEnsemble: false
  needsDesign: true
```

### Prompt Composition (Same as Refactor Plan)

Base prompts use `{{OVERLAY:slot}}` markers. Overlay files use `## slot` sections. Assembly at runtime. This is the same mechanism from the refactor plan — it carries over directly.

## Architecture

### System Layers

```
┌─────────────────────────────────────────────────┐
│                   CLI / Web UI                   │
│         (commands, spinner, monitoring)          │
├─────────────────────────────────────────────────┤
│               Pipeline Compiler                  │
│    (YAML DSL → Mastra Workflow + Agents)         │
├─────────────────────────────────────────────────┤
│              Mastra Runtime Layer                 │
│   (workflow execution, state, streaming, tools)  │
├─────────────────────────────────────────────────┤
│             Agent Prompt Assembly                 │
│      (base templates + domain overlays)          │
├─────────────────────────────────────────────────┤
│          Tool / Skill Registry (MCP)             │
│    (canvas-screenshot, shader-validate, etc.)    │
└─────────────────────────────────────────────────┘
```

### Pipeline Compiler

The key new component. Reads a `.pipeline.yaml` + a `.flavour.yaml` and produces a Mastra workflow:

```typescript
// src/compiler/pipeline.compile.ts

import { createWorkflow, createStep } from '@mastra/core';

interface CompiledPipeline {
  workflow: MastraWorkflow;
  agents: Map<string, MastraAgent>;
}

function compilePipeline(
  pipelineDef: PipelineDefinition,
  flavourDef: FlavourDefinition
): CompiledPipeline {
  // 1. Merge flavour overrides into pipeline definition
  const merged = mergeFlavourOverrides(pipelineDef, flavourDef);

  // 2. For each step, create a Mastra step:
  //    - If step.agent → create agent step (single agent invocation)
  //    - If step.ensemble → create ensemble step (parallel specialists + synthesizer)
  //    - If step.mode === 'sequential-phases' → create phase-loop step
  //    - If step.condition → wrap in branch

  // 3. Assemble prompts for each agent (base + overlay from flavour)

  // 4. Wire steps together based on declared inputs/outputs

  // 5. Return compiled Mastra workflow
}
```

### Mastra Step Types

#### Single Agent Step
```typescript
const shapeStep = createStep({
  id: 'shape',
  inputSchema: z.object({ intent: z.string(), codebasePath: z.string() }),
  outputSchema: z.object({ shapeMd: z.string() }),
  execute: async ({ inputData, runtimeContext }) => {
    const agent = runtimeContext.get('agents').get('shaper');
    const result = await agent.generate(inputData.intent, {
      system: assemblePrompt('shaper', runtimeContext.get('flavour'))
    });
    return { shapeMd: result.text };
  }
});
```

#### Ensemble Step
```typescript
const specStep = createStep({
  id: 'spec',
  execute: async ({ inputData, runtimeContext }) => {
    const specialists = runtimeContext.get('ensemble:spec:specialists');
    const synthesizer = runtimeContext.get('agents').get('specifier');

    // Parallel specialist invocation
    const drafts = await Promise.all(
      specialists.map(s => s.agent.generate(inputData.specInput, {
        system: s.assembledPrompt
      }))
    );

    // Synthesizer reads all drafts
    const synthResult = await synthesizer.generate(
      formatDrafts(drafts),
      { system: assemblePrompt('specifier', runtimeContext.get('flavour')) }
    );

    return { specMd: synthResult.text };
  }
});
```

#### Phase-Loop Step (Build)
```typescript
const buildStep = createStep({
  id: 'build',
  execute: async ({ inputData, state, setState, runtimeContext }) => {
    const phases = inputData.phases;
    const builder = runtimeContext.get('agents').get('builder');
    const reviewer = runtimeContext.get('agents').get('reviewer');
    let handoff = '';

    for (const phase of phases) {
      let attempts = 0;
      let passed = false;

      while (!passed && attempts < runtimeContext.get('config').maxRetries) {
        // Build
        const buildResult = await builder.generate(
          formatBuildInput(phase, handoff, inputData),
          { system: assemblePrompt('builder', runtimeContext.get('flavour')) }
        );

        // Review
        const reviewResult = await reviewer.generate(
          formatReviewInput(phase, buildResult),
          { system: assemblePrompt('reviewer', runtimeContext.get('flavour')) }
        );

        if (reviewResult.passed) {
          passed = true;
          handoff += buildResult.handoffSection;
          setState({ completedPhases: [...state.completedPhases, phase.id] });
        } else {
          attempts++;
        }
      }
    }

    return { handoff, success: true };
  }
});
```

### State Management

Replace `state.json` + `handoff.md` with Mastra's workflow state:

```typescript
const pipelineWorkflow = createWorkflow({
  id: 'code-generation',
  stateSchema: z.object({
    // Pipeline progress
    completedSteps: z.array(z.string()),
    completedPhases: z.array(z.string()),

    // Artifacts (file paths or content)
    shapeMd: z.string().optional(),
    specMd: z.string().optional(),
    constraintsMd: z.string().optional(),
    tasteMd: z.string().optional(),
    designMd: z.string().optional(),
    researchMd: z.string().optional(),
    handoff: z.string().optional(),
    phases: z.array(z.object({ id: z.string(), content: z.string() })).optional(),

    // Budget tracking
    totalCostUsd: z.number(),
    stepCosts: z.array(z.object({
      stepId: z.string(),
      costUsd: z.number(),
      inputTokens: z.number(),
      outputTokens: z.number()
    })),

    // Config (from flavour + CLI flags)
    config: z.record(z.unknown())
  })
});
```

### Tool Registry via MCP

Instead of per-flavour package special-casing, tools are MCP servers:

```typescript
// tools/canvas-screenshot.tool.ts
export const canvasScreenshotTool = createTool({
  id: 'canvas-screenshot',
  description: 'Capture a screenshot of an HTML canvas element',
  inputSchema: z.object({
    url: z.string(),
    selector: z.string().default('canvas'),
    outputPath: z.string()
  }),
  outputSchema: z.object({ path: z.string(), width: z.number(), height: z.number() }),
  execute: async ({ url, selector, outputPath }) => {
    // Shell out to canvas-screenshot binary or use puppeteer
  }
});
```

Flavours declare which tools they need in the manifest. The runtime checks availability and offers installation guidance — same as current `ridgeline check` but driven by manifest, not SKILL.md parsing.

## Implementation Phases

### Phase 1: Scaffold Mastra Project

1. `npx create-mastra@latest ridgeline-next` in a new directory (or subdirectory)
2. Configure TypeScript, ESLint (carry over current lint setup)
3. Set up the directory structure:

```
ridgeline-next/
  src/
    cli/                    # CLI entry point (commander.js, same UX)
    compiler/               # Pipeline compiler (YAML → Mastra workflow)
    prompts/                # Base prompt templates
      base/
        builder.base.md
        planner.base.md
        ...
    agents/                 # Agent definitions (YAML + Mastra Agent wrappers)
    steps/                  # Reusable Mastra step implementations
      shape.step.ts
      spec.step.ts
      research.step.ts
      plan.step.ts
      build.step.ts
      review.step.ts
      design.step.ts
      refine.step.ts
    pipelines/              # Pipeline definitions (YAML DSL)
      code-generation.pipeline.yaml
    flavours/               # Flavour configs + overlays
      web-game/
      software-engineering/
      ...
    tools/                  # Tool definitions (Mastra createTool)
    ui/                     # CLI output (spinner, logger — port from current)
    ensemble/               # Ensemble execution logic (specialist parallel invoke + synthesize)
  mastra.config.ts          # Mastra configuration
```

### Phase 2: Port Prompt Assembly

1. Copy the prompt assembly engine from the refactor plan (it's the same system)
2. Create base templates from current agent files
3. Extract overlays for web-game and software-engineering (minimum viable set)
4. Unit test assembly: base + overlay → correct output

### Phase 3: Implement Core Steps

Port each pipeline stage as a Mastra step:

1. **Shape step** — interactive Q&A using Mastra agent with streaming
2. **Spec step** — ensemble pattern (parallel specialists + synthesizer)
3. **Research step** — ensemble with web search tools, repeatable
4. **Refine step** — single agent merging research into spec
5. **Plan step** — ensemble with optional two-round annotation
6. **Build step** — phase-loop with builder + reviewer retry cycle
7. **Design step** — interactive Q&A (conditional)

Each step is a standalone module that:
- Declares its input/output schema (Zod)
- Reads config from Mastra runtimeContext
- Uses assembled prompts from the prompt engine
- Streams output through the CLI UI layer

### Phase 4: Build the Pipeline Compiler

1. Define the YAML DSL schema (JSON Schema for validation)
2. Implement `compilePipeline()`:
   - Parse pipeline YAML
   - Parse flavour YAML
   - Merge overrides
   - Create Mastra workflow by wiring steps
3. Handle:
   - Conditional steps (`.branch()`)
   - Repeatable steps (research loop)
   - Sequential phase execution (build)
   - Ensemble steps (parallel + synthesize)
4. Test: compile `code-generation.pipeline.yaml` + `web-game/flavour.yaml` → working Mastra workflow

### Phase 5: Port CLI

1. Same commander.js interface: `ridgeline shape`, `ridgeline build`, etc.
2. Port the spinner, grey text output, phase headers from current `src/ui/`
3. Wire CLI commands to:
   - Load pipeline definition
   - Load flavour
   - Compile to Mastra workflow
   - Execute with streaming output
4. Port state management:
   - Use Mastra's built-in suspend/resume instead of state.json
   - Keep `.ridgeline/builds/{name}/` directory structure for artifacts
   - Budget tracking via Mastra's onStepFinish callbacks

### Phase 6: Port Ensemble Mechanics

The ensemble pattern is Ridgeline's key differentiator. Port it cleanly:

1. Create `src/ensemble/ensemble.exec.ts` that wraps Mastra's parallel execution
2. Support:
   - Specialist discovery from flavour config
   - Parallel invocation with independent prompts
   - Optional two-round annotation (specialists review each other)
   - Synthesizer consolidation
   - Structured JSON extraction from specialist outputs
3. Make ensembles a first-class step type in the DSL:

```yaml
spec:
  ensemble:
    specialists: [clarity-specifier, completeness-specifier, pragmatism-specifier]
    synthesizer: specifier
    twoRound: false
```

### Phase 7: Tool & Skill System

1. Define tools as Mastra `createTool()` wrappers
2. Port skill checking from `skill.check.ts`
3. Flavour manifest declares tool requirements → runtime validates
4. Future: expose tools as MCP servers so external clients can use them

### Phase 8: End-to-End Validation

1. Run the full code-generation pipeline with web-game flavour
2. Run with software-engineering flavour
3. Compare output quality to current system
4. Verify: streaming output, spinner, budget tracking, state resume all work
5. Performance benchmark: compilation time, step execution overhead

## Future Phases (Post-MVP)

### Phase 9: Visual Pipeline Editor (The Factorio UI)

Build on Mastra Studio as the foundation:

1. **Node graph view** — each step is a node, connections show data flow
2. **Live execution monitoring** — nodes light up as they execute, show token counts and costs
3. **Drag-and-drop pipeline construction** — users wire steps together visually
4. **Agent configuration panels** — click a node to edit its prompt, tools, model
5. **Flavour switching** — dropdown to swap the overlay set, see prompt changes in real-time
6. **Execution history** — timeline of past runs with artifacts and costs

Tech stack: React + tldraw or reactflow for the node graph, WebSocket for live updates, Mastra's built-in REST API for backend.

### Phase 10: Custom Pipeline DSL Tooling

1. **Pipeline validator** — CLI command to validate YAML against schema
2. **Pipeline visualizer** — generate a Mermaid diagram from YAML
3. **Flavour scaffolder** — `ridgeline new-flavour my-domain` generates overlay stubs
4. **Pipeline marketplace** — share pipeline definitions and flavour configs

### Phase 11: Multi-Pipeline Orchestration

Different use-cases get different pipeline shapes:

```yaml
# pipelines/quick-fix.pipeline.yaml — no research, no ensembles
steps:
  shape:
    agent: shaper
    mode: interactive
  build:
    agent: builder
    inputs: [shape.md]
    review:
      agent: reviewer
      maxRetries: 1
```

```yaml
# pipelines/creative-writing.pipeline.yaml — no build/review, adds editing
steps:
  shape:
    agent: shaper
    mode: interactive
  research:
    ensemble: ...
  outline:
    agent: outliner           # different step entirely
  draft:
    agent: drafter
    mode: sequential-chapters
  edit:
    ensemble:
      specialists: [style-editor, continuity-editor, prose-editor]
      synthesizer: editor
```

Users pick a pipeline, then a flavour configures the agents within it.

## Migration Strategy

This is a from-scratch build, not a refactor. Migration approach:

1. Build `ridgeline-next/` alongside current `ridgeline/`
2. Port subsystems incrementally (prompts first, then steps, then CLI)
3. Run both in parallel during validation
4. Cut over when `ridgeline-next` produces equivalent or better output
5. Keep the current system as reference/fallback

**What carries over directly:**
- All prompt content (base templates + overlays — identical to refactor plan)
- CLI UX patterns (spinner, grey text, phase headers)
- Pipeline step logic (shape, spec, research, plan, build — same algorithms, new framework)
- Budget tracking logic
- Ensemble mechanics (same pattern, Mastra execution)

**What gets replaced:**
- `state.json` → Mastra workflow state
- `handoff.md` threading → Mastra step state
- `agent.registry.ts` → Pipeline compiler + Mastra agents
- `claude --print` invocation → Mastra agent.generate()
- Custom ensemble orchestration → Mastra parallel steps
- Checkpoint/resume system → Mastra suspend/resume

**What's new:**
- Pipeline YAML DSL
- Pipeline compiler
- Mastra Studio integration
- MCP-based tool system
- REST API for all pipelines/agents (enables future web UI)

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Mastra's agent abstraction may not support our ensemble pattern natively | Ensembles are implemented as custom step logic within Mastra steps — we don't depend on Mastra's multi-agent patterns |
| YAML DSL becomes its own maintenance burden | Start with a minimal schema. Only add DSL features when a real pipeline needs them. Validate against JSON Schema. |
| Mastra version churn | Pin to specific version. Mastra's core workflow/agent APIs are stable (v1.x). Avoid bleeding-edge features. |
| Loss of CLI polish during port | Port UI layer first, wire to Mastra second. Keep the spinner/output code as an independent module. |
| Mastra's Claude integration may not match our current `claude --print` usage | Mastra uses Vercel AI SDK under the hood — supports Anthropic models natively. If needed, wrap `claude --print` as a Mastra tool for exact parity. |
| Dynamic workflow construction from YAML may hit Mastra limitations | The compiler produces static Mastra workflows at startup time, not truly dynamic runtime construction. This is simpler and more predictable. |
| Factorio UI is a massive scope expansion | Phase 9+ is post-MVP. The DSL + CLI must work standalone first. UI is additive, not foundational. |

## Decision Point

The refactor plan (composable layers) is lower risk, preserves all current functionality, and solves the immediate maintenance pain. It can be done in ~2-3 sessions.

The Mastra redesign is higher ambition — it solves the maintenance pain AND opens up composable pipelines, visual editing, REST APIs, and multi-pipeline support. But it's a from-scratch build requiring ~8-12 sessions.

**Recommendation**: Do the refactor first (it produces the base templates and overlays that both paths need), then start the Mastra build using those same prompt assets. The refactor is not wasted work — it's Phase 2 of the Mastra plan.
