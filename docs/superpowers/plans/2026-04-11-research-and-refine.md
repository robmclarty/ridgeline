# Research & Refine Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new optional pipeline commands — `ridgeline research` and `ridgeline refine` — that let users enrich their spec with web-sourced findings (academic papers, latest docs, competitive intelligence) before planning.

**Architecture:** Reuse the existing `invokeEnsemble` engine with a new `isStructured` option that skips JSON schema enforcement, allowing research specialists to output prose. Quick mode runs a single researcher; deep mode runs three parallel specialists (academic, ecosystem, competitive) + a synthesizer. A separate `refine` command merges `research.md` into `spec.md` via a dedicated refiner agent. Auto mode (`--auto [N]`) chains research → refine for N iterations.

**Tech Stack:** TypeScript, Commander.js CLI, Claude CLI subprocess invocation, existing ensemble engine.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/commands/research.ts` | CLI command handler for `ridgeline research` |
| Create | `src/commands/refine.ts` | CLI command handler for `ridgeline refine` |
| Create | `src/engine/pipeline/research.exec.ts` | Research ensemble executor — builds prompts, invokes ensemble, writes `research.md` |
| Create | `src/engine/pipeline/refine.exec.ts` | Refine executor — reads `research.md` + `spec.md`, invokes refiner agent, overwrites `spec.md` |
| Create | `src/agents/core/researcher.md` | Core researcher synthesizer prompt |
| Create | `src/agents/core/refiner.md` | Core refiner agent prompt |
| Create | `src/agents/researchers/academic.md` | Academic research specialist (arxiv, papers, novel approaches) |
| Create | `src/agents/researchers/ecosystem.md` | Ecosystem research specialist (framework docs, new features, libraries) |
| Create | `src/agents/researchers/competitive.md` | Competitive research specialist (how others solve the problem) |
| Create | `src/agents/researchers/context.md` | Shared context for all research specialists |
| Create | `src/flavours/*/researchers/academic.md` | Flavour-specific academic researcher (×13 flavours) |
| Create | `src/flavours/*/researchers/ecosystem.md` | Flavour-specific ecosystem researcher (×13 flavours) |
| Create | `src/flavours/*/researchers/competitive.md` | Flavour-specific competitive researcher (×13 flavours) |
| Create | `src/flavours/*/core/researcher.md` | Flavour-specific researcher synthesizer (×13 flavours) |
| Create | `src/flavours/*/core/refiner.md` | Flavour-specific refiner agent (×13 flavours) |
| Modify | `src/engine/pipeline/ensemble.exec.ts` | Add `isStructured` flag to `EnsembleConfig` to skip JSON schema |
| Modify | `src/types.ts` | Add trajectory types, budget roles, pipeline stages |
| Modify | `src/stores/state.ts` | Add research/refine as optional pipeline stages |
| Modify | `src/stores/settings.ts` | Add research-specific network domains to defaults |
| Modify | `src/cli.ts` | Register `research` and `refine` commands |
| Modify | `src/commands/create.ts` | Add research/refine stage labels for status display |
| Modify | `src/commands/rewind.ts` | Add research/refine to valid rewind targets |

---

### Task 1: Add `isStructured` Flag to Ensemble Engine

**Files:**

- Modify: `src/engine/pipeline/ensemble.exec.ts:59-97` (EnsembleConfig type)
- Modify: `src/engine/pipeline/ensemble.exec.ts:99-217` (invokeEnsemble function)

This is the foundational change that enables prose output from research specialists. When `isStructured` is `false`, the ensemble skips JSON schema enforcement and returns raw text from specialists instead of parsed JSON.

- [ ] **Step 1: Add `isStructured` field to `EnsembleConfig`**

In `src/engine/pipeline/ensemble.exec.ts`, add the field to the `EnsembleConfig` type:

```typescript
type EnsembleConfig<TDraft> = {
  /** Human label for spinner and error messages, e.g., "Planning" or "Specifying" */
  label: string

  /** Pre-resolved specialists from the agent registry */
  specialists: SpecialistDef[]

  /** Build the system prompt for a specialist given their overlay text */
  buildSpecialistPrompt: (overlay: string) => string

  /** The user prompt sent to each specialist */
  specialistUserPrompt: string

  /** JSON schema string for structured specialist output. Ignored when isStructured is false. */
  specialistSchema: string

  /**
   * When true (default), specialists output structured JSON parsed via specialistSchema.
   * When false, specialists output free-form prose returned as-is in TDraft (expects TDraft = string).
   */
  isStructured?: boolean

  /** Pre-resolved synthesizer system prompt content */
  synthesizerPrompt: string

  /** Build the synthesizer user prompt from successful drafts */
  buildSynthesizerUserPrompt: (
    drafts: { perspective: string; draft: TDraft }[]
  ) => string

  /** Allowed tools for the synthesizer invocation */
  synthesizerTools: string[]

  /** Allowed tools for specialist invocations (default: none) */
  specialistTools?: string[]

  /** Model name for invokeClaude */
  model: string

  /** Timeout in minutes */
  timeoutMinutes: number

  /** Budget cap (null = unlimited) */
  maxBudgetUsd: number | null

  /** Optional post-synthesis verification. Throw to signal failure. */
  verify?: () => void

  /** Network allowlist for specialist invocations (e.g., research needs web access) */
  networkAllowlist?: string[]

  /** Sandbox provider for specialist invocations */
  sandboxProvider?: import("../../types").RidgelineConfig["sandboxProvider"]
}
```

Note: We also add `specialistTools` (research specialists need `WebFetch`, `WebSearch`, `Bash`), `networkAllowlist`, and `sandboxProvider` — the current ensemble engine doesn't pass these to specialists.

- [ ] **Step 2: Update `invokeEnsemble` to handle unstructured output**

Modify the specialist invocation in `invokeEnsemble` to conditionally skip JSON schema and parsing:

```typescript
// In the specialistPromises map (around line 111):
const specialistPromises = specialists.map(({ perspective, overlay }) => {
  const systemPrompt = config.buildSpecialistPrompt(overlay)
  const startTime = Date.now()
  const isStructured = config.isStructured !== false // default true

  return invokeClaude({
    systemPrompt,
    userPrompt: config.specialistUserPrompt,
    model: config.model,
    allowedTools: config.specialistTools ?? [],
    cwd: process.cwd(),
    timeoutMs: config.timeoutMinutes * 60 * 1000,
    jsonSchema: isStructured ? config.specialistSchema : undefined,
    onStderr: createStderrHandler(perspective),
    networkAllowlist: config.networkAllowlist,
    sandboxProvider: config.sandboxProvider,
  }).then((result) => {
    const elapsed = formatElapsed(Date.now() - startTime)
    spinner.printAbove(`  ${perspective.padEnd(14)} complete (${elapsed}, $${result.costUsd.toFixed(2)})`)
    return { perspective, result }
  })
})
```

Then update the proposal collection loop (around line 134) to handle both modes:

```typescript
// 3. Collect successful proposals
const successful: { perspective: string; result: ClaudeResult; draft: TDraft }[] = []
const isStructured = config.isStructured !== false

for (const outcome of settled) {
  if (outcome.status === "fulfilled") {
    const { perspective, result } = outcome.value
    if (isStructured) {
      try {
        const draft = extractJSON(result.result) as TDraft
        successful.push({ perspective, result, draft })
      } catch {
        const preview = result.result.length > 300
          ? result.result.slice(0, 300) + "..."
          : result.result
        printError(`Failed to parse ${perspective} specialist output as JSON. Preview:\n${preview}`)
      }
    } else {
      // Prose mode: treat the raw result text as the draft
      successful.push({ perspective, result, draft: result.result as TDraft })
    }
  } else {
    printError(`Specialist failed: ${outcome.reason}`)
  }
}
```

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS (no errors related to ensemble changes)

- [ ] **Step 4: Commit**

```bash
git add src/engine/pipeline/ensemble.exec.ts
git commit -m "feat: add isStructured flag to ensemble engine for prose output"
```

---

### Task 2: Extend Type System

**Files:**

- Modify: `src/types.ts:45-60` (PipelineStage, PipelineState, BuildState)
- Modify: `src/types.ts:156-194` (BudgetEntry, TrajectoryEntry)

- [ ] **Step 1: Add research and refine to pipeline types**

In `src/types.ts`, update the pipeline types. Research and refine are optional — they use a separate status field that doesn't gate spec→plan progression:

```typescript
// Pipeline stage status
export type PipelineStage = "shape" | "spec" | "research" | "refine" | "plan" | "build"

export type PipelineState = {
  shape: "pending" | "complete"
  spec: "pending" | "complete"
  research: "pending" | "complete" | "skipped"
  refine: "pending" | "complete" | "skipped"
  plan: "pending" | "complete"
  build: "pending" | "running" | "complete"
}
```

- [ ] **Step 2: Add researcher role to BudgetEntry**

```typescript
// Single entry in budget.json
export type BudgetEntry = {
  phase: string
  role: "planner" | "builder" | "reviewer" | "specialist" | "synthesizer" | "researcher" | "refiner"
  attempt: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  durationMs: number
  timestamp: string
}
```

- [ ] **Step 3: Add trajectory event types**

```typescript
// Single entry in trajectory.jsonl
export type TrajectoryEntry = {
  timestamp: string
  type:
    | "plan_start"
    | "plan_complete"
    | "build_start"
    | "build_complete"
    | "review_start"
    | "review_complete"
    | "phase_advance"
    | "phase_fail"
    | "budget_exceeded"
    | "research_start"
    | "research_complete"
    | "refine_start"
    | "refine_complete"
  phaseId: string | null
  duration: number | null
  tokens: { input: number; output: number } | null
  costUsd: number | null
  summary: string
}
```

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat: add research/refine pipeline stages and budget/trajectory types"
```

---

### Task 3: Update Pipeline State Management

**Files:**

- Modify: `src/stores/state.ts:9-14` (DEFAULT_PIPELINE)
- Modify: `src/stores/state.ts:98-112` (derivePipelineFromArtifacts)
- Modify: `src/stores/state.ts:114-127` (getPipelineStatus)
- Modify: `src/stores/state.ts:163` (PIPELINE_STAGES)
- Modify: `src/stores/state.ts:166-173` (getNextPipelineStage)
- Modify: `src/stores/state.ts:176-205` (collectStageFiles)

Research and refine are optional stages. The key design decision: `getNextPipelineStage` should skip research/refine when they are "skipped" or "pending" — they never block auto-advance. They are only entered explicitly via their own commands.

- [ ] **Step 1: Update DEFAULT_PIPELINE and PIPELINE_STAGES**

```typescript
const DEFAULT_PIPELINE: PipelineState = {
  shape: "pending",
  spec: "pending",
  research: "skipped",
  refine: "skipped",
  plan: "pending",
  build: "pending",
}

// The ordered list of stages for auto-advance.
// Research and refine are excluded — they are opt-in only.
const REQUIRED_PIPELINE_STAGES: PipelineStage[] = ["shape", "spec", "plan", "build"]

// All stages including optional ones, for rewind calculations.
const ALL_PIPELINE_STAGES: PipelineStage[] = ["shape", "spec", "research", "refine", "plan", "build"]
```

- [ ] **Step 2: Update `derivePipelineFromArtifacts`**

Add research.md detection:

```typescript
const derivePipelineFromArtifacts = (buildDir: string): PipelineState => {
  const hasShape = fs.existsSync(path.join(buildDir, "shape.md"))
  const hasSpec = fs.existsSync(path.join(buildDir, "spec.md"))
  const hasConstraints = fs.existsSync(path.join(buildDir, "constraints.md"))
  const hasResearch = fs.existsSync(path.join(buildDir, "research.md"))
  const phasesDir = path.join(buildDir, "phases")
  const hasPhases = fs.existsSync(phasesDir) &&
    fs.readdirSync(phasesDir).some((f) => f.endsWith(".md") && /^\d+-.+\.md$/.test(f))

  return {
    shape: hasShape ? "complete" : "pending",
    spec: hasSpec && hasConstraints ? "complete" : "pending",
    research: hasResearch ? "complete" : "skipped",
    refine: hasResearch ? "complete" : "skipped",
    plan: hasPhases ? "complete" : "pending",
    build: "pending",
  }
}
```

- [ ] **Step 3: Update `getPipelineStatus`**

Add research and refine to the belt-and-suspenders check:

```typescript
export const getPipelineStatus = (buildDir: string): PipelineState => {
  const state = loadState(buildDir)
  const fromState = state?.pipeline ?? { ...DEFAULT_PIPELINE }
  const fromDisk = derivePipelineFromArtifacts(buildDir)

  return {
    shape: fromState.shape === "complete" && fromDisk.shape === "complete" ? "complete" : fromDisk.shape,
    spec: fromState.spec === "complete" && fromDisk.spec === "complete" ? "complete" : fromDisk.spec,
    research: fromState.research ?? "skipped",
    refine: fromState.refine ?? "skipped",
    plan: fromState.plan === "complete" && fromDisk.plan === "complete" ? "complete" : fromDisk.plan,
    build: fromState.build === "pending" ? "pending" : fromState.build,
  }
}
```

- [ ] **Step 4: Update `getNextPipelineStage` to skip optional stages**

```typescript
export const getNextPipelineStage = (buildDir: string): PipelineStage | null => {
  const status = getPipelineStatus(buildDir)
  for (const stage of REQUIRED_PIPELINE_STAGES) {
    const s = status[stage]
    if (s === "pending" || s === "running") return stage
  }
  return null
}
```

- [ ] **Step 5: Update `collectStageFiles` for research and refine**

Add cases for the new stages:

```typescript
const collectStageFiles = (buildDir: string, stage: PipelineStage): string[] => {
  const files: string[] = []
  const phasesDir = path.join(buildDir, "phases")

  switch (stage) {
    case "research": {
      const fp = path.join(buildDir, "research.md")
      if (fs.existsSync(fp)) files.push(fp)
      break
    }
    case "refine":
      // Refine modifies spec.md in-place — no separate artifact to delete.
      // Rewinding to refine means "undo the refinement" which requires
      // rewinding spec too (the user should rewind to spec instead).
      break
    case "spec":
      for (const f of ["spec.md", "constraints.md", "taste.md"]) {
        const fp = path.join(buildDir, f)
        if (fs.existsSync(fp)) files.push(fp)
      }
      break
    // ... existing plan and build cases unchanged
  }

  return files
}
```

- [ ] **Step 6: Update `rewindTo` and `resetPipelineState` to use `ALL_PIPELINE_STAGES`**

```typescript
export const rewindTo = (buildDir: string, buildName: string, targetStage: PipelineStage): string[] => {
  const resetStages = ALL_PIPELINE_STAGES.slice(ALL_PIPELINE_STAGES.indexOf(targetStage) + 1)
  const toDelete = resetStages.flatMap((stage) => collectStageFiles(buildDir, stage))

  resetPipelineState(buildDir, buildName, targetStage, resetStages)

  return toDelete
}

const resetPipelineState = (
  buildDir: string,
  buildName: string,
  targetStage: PipelineStage,
  resetStages: PipelineStage[],
): void => {
  const state = loadState(buildDir)
  if (!state) return

  const targetIndex = ALL_PIPELINE_STAGES.indexOf(targetStage)
  for (const stage of ALL_PIPELINE_STAGES) {
    if (ALL_PIPELINE_STAGES.indexOf(stage) > targetIndex) {
      // Optional stages reset to "skipped", required stages to "pending"
      if (stage === "research" || stage === "refine") {
        state.pipeline[stage] = "skipped" as any
      } else {
        state.pipeline[stage] = "pending" as any
      }
    }
  }

  if (targetStage === "build") {
    state.pipeline.build = "pending"
  } else if (targetStage === "research" || targetStage === "refine") {
    state.pipeline[targetStage] = "complete" as any
  } else {
    state.pipeline[targetStage] = "complete"
  }

  if (resetStages.includes("plan") || resetStages.includes("build")) {
    state.phases = []
  }

  if (resetStages.includes("build")) {
    cleanupBuildTags(buildName)
  }

  saveState(buildDir, state)
}
```

- [ ] **Step 7: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/stores/state.ts
git commit -m "feat: add research/refine as optional pipeline stages in state management"
```

---

### Task 4: Add Research Network Domains to Settings

**Files:**

- Modify: `src/stores/settings.ts:11-26` (DEFAULT_NETWORK_ALLOWLIST)

Research agents need access to academic sources, documentation sites, and general web search. Add domains that the research agents will commonly need.

- [ ] **Step 1: Add research domains**

```typescript
/** Additional domains needed for research agents (web search, docs, academic). */
export const RESEARCH_NETWORK_DOMAINS: string[] = [
  "arxiv.org",
  "export.arxiv.org",
  "api.semanticscholar.org",
  "scholar.google.com",
  "docs.python.org",
  "developer.mozilla.org",
  "docs.rs",
  "pkg.go.dev",
  "learn.microsoft.com",
  "devdocs.io",
]

export const DEFAULT_NETWORK_ALLOWLIST: string[] = [
  ...CLAUDE_REQUIRED_DOMAINS,
  "registry.npmjs.org",
  "nodejs.org",
  "objects.githubusercontent.com",
  "raw.githubusercontent.com",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "static.crates.io",
  "rubygems.org",
  "proxy.golang.org",
  "github.com",
  "gitlab.com",
  "bitbucket.org",
]
```

Note: `RESEARCH_NETWORK_DOMAINS` is exported but not merged into the default allowlist. It will be merged at invocation time by the research command, so non-research builds don't get extra network access.

- [ ] **Step 2: Add helper to build research allowlist**

```typescript
/** Build the network allowlist for research agents: base allowlist + research domains. */
export const resolveResearchAllowlist = (ridgelineDir: string): string[] => {
  const base = resolveNetworkAllowlist(ridgelineDir)
  // If base is empty, user set "*" (unrestricted) — keep it unrestricted
  if (base.length === 0) return []
  const merged = new Set([...base, ...RESEARCH_NETWORK_DOMAINS])
  return [...merged]
}
```

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/stores/settings.ts
git commit -m "feat: add research network domains and allowlist helper"
```

---

### Task 5: Create Research Specialist Agents

**Files:**

- Create: `src/agents/researchers/context.md`
- Create: `src/agents/researchers/academic.md`
- Create: `src/agents/researchers/ecosystem.md`
- Create: `src/agents/researchers/competitive.md`

These are markdown files with frontmatter, following the same pattern as `src/agents/specifiers/*.md` and `src/agents/planners/*.md`.

- [ ] **Step 1: Create shared context for all research specialists**

Write `src/agents/researchers/context.md`:

```markdown
# Research Context

You are a research specialist in an ensemble pipeline. Your job is to investigate external sources and produce findings that could improve a software specification.

## Your Inputs

You receive:
- **spec.md** — the current specification describing what is being built
- **constraints.md** — technical constraints (language, framework, runtime)
- **taste.md** (optional) — style preferences

## Your Output

Produce a prose research report in markdown. Structure it as:

### Findings

For each finding, include:
- **Source**: URL or citation
- **Relevance**: Why this matters to the spec
- **Recommendation**: What the spec should consider changing or adding

### Summary

A brief paragraph summarizing the most impactful findings.

## Research Guidelines

- Focus on findings that are **actionable** for the spec — skip general knowledge the builder would already have.
- Prefer primary sources (official docs, papers, release notes) over secondary summaries.
- When you find conflicting approaches, present both with trade-offs rather than picking one.
- Be honest about confidence levels — a well-sourced finding is worth more than a speculative one.
- Target 5-15 findings. Quality over quantity.
- Include URLs so the user can verify your sources.

## Tool Usage

You have access to web search and web fetch tools. Use them to:
1. Search for relevant information
2. Fetch and read specific pages
3. Verify claims against primary sources

Do NOT use Write or Edit tools. Your output is your response text only.
```

- [ ] **Step 2: Create academic research specialist**

Write `src/agents/researchers/academic.md`:

```markdown
---
name: academic
description: Searches academic papers, arxiv, and research for novel algorithms, architectures, and techniques
perspective: academic
---

You are the Academic Research Specialist. Your focus is on cutting-edge research that could inform the specification — novel algorithms, architectural patterns, data structures, or techniques from recent papers.

## Where to Search

- arxiv.org (cs.SE, cs.AI, cs.PL, cs.DC, cs.DB — pick relevant categories)
- Semantic Scholar for citation-rich papers
- Google Scholar for broad academic coverage
- Conference proceedings (ICSE, SOSP, OSDI, VLDB, etc.) referenced in search results

## What to Look For

- Novel approaches to problems described in the spec
- Recent papers (last 2 years) on algorithms or architectures relevant to the spec's domain
- Techniques that could simplify or improve the proposed approach
- Known pitfalls or failure modes documented in research

## What to Skip

- Textbook material the builder would already know
- Papers that are purely theoretical with no practical application to the spec
- Research in unrelated domains unless the technique transfers clearly
```

- [ ] **Step 3: Create ecosystem research specialist**

Write `src/agents/researchers/ecosystem.md`:

```markdown
---
name: ecosystem
description: Researches latest framework documentation, library features, and tooling updates
perspective: ecosystem
---

You are the Ecosystem Research Specialist. Your focus is on the specific technologies mentioned in the spec and constraints — their latest versions, new features, best practices, and ecosystem tools.

## Where to Search

- Official documentation for frameworks/libraries mentioned in constraints.md
- Release notes and changelogs for recent versions
- GitHub repositories for new releases, migration guides, and examples
- Package registry pages (npm, PyPI, crates.io, etc.) for dependency updates

## What to Look For

- New framework/library features that could simplify the spec's implementation
- Deprecations or breaking changes that could affect the planned approach
- Built-in solutions that would replace custom implementations in the spec
- Official best practices or patterns recommended by framework authors
- Performance characteristics documented in benchmarks or release notes

## What to Skip

- Version history older than the currently specified versions
- Features unrelated to the spec's requirements
- Community blog posts when official docs cover the same ground
```

- [ ] **Step 4: Create competitive research specialist**

Write `src/agents/researchers/competitive.md`:

```markdown
---
name: competitive
description: Investigates how other tools and products solve similar problems
perspective: competitive
---

You are the Competitive Research Specialist. Your focus is on understanding how other projects, tools, or products approach the same problem space as the spec.

## Where to Search

- GitHub repositories solving similar problems (sort by stars, recent activity)
- Product pages and documentation of competing/adjacent tools
- Developer blog posts comparing approaches in this domain
- Hacker News, Reddit, and Stack Overflow discussions about the problem space

## What to Look For

- UX patterns or API designs that feel particularly well-considered
- Features that users commonly request or praise in competing tools
- Architectural decisions other projects made and their documented trade-offs
- Anti-patterns or mistakes other projects warn about in their docs
- Novel approaches that differentiate a competitor from the obvious solution

## What to Skip

- Superficial feature lists without insight into why choices were made
- Closed-source products where you can't see the approach behind the interface
- Projects that are abandoned or unmaintained (unless the ideas are still relevant)
```

- [ ] **Step 5: Commit**

```bash
git add src/agents/researchers/
git commit -m "feat: add research specialist agents (academic, ecosystem, competitive)"
```

---

### Task 5b: Create Flavour-Specific Research Agents

**Files:**

- Create: `src/flavours/<flavour>/researchers/academic.md` (×13)
- Create: `src/flavours/<flavour>/researchers/ecosystem.md` (×13)
- Create: `src/flavours/<flavour>/researchers/competitive.md` (×13)
- Create: `src/flavours/<flavour>/core/researcher.md` (×13)
- Create: `src/flavours/<flavour>/core/refiner.md` (×13)

Each flavour needs its own `researchers/` subdirectory with domain-tailored research specialists, plus flavour-specific `researcher.md` and `refiner.md` core agents. The agent registry already handles subfolder-level fallback — if a flavour doesn't override a file, the generic default is used. But research benefits enormously from domain focus, so every flavour should override.

The pattern for each specialist is the same as the specifier overrides: same frontmatter (name, description, perspective), but the prompt body is rewritten for the domain.

- [ ] **Step 1: Create software-engineering flavour researchers**

Write `src/flavours/software-engineering/researchers/academic.md`:

```markdown
---
name: academic
description: Searches academic papers for novel algorithms, architectures, distributed systems patterns, and software engineering research
perspective: academic
---

You are the Academic Research Specialist for a software engineering project. Focus on cutting-edge research relevant to building production software — distributed systems, data structures, concurrency models, type systems, testing methodologies, and software architecture.

## Where to Search

- arxiv.org (cs.SE, cs.DC, cs.PL, cs.DB, cs.CR — pick relevant categories)
- Semantic Scholar for citation-rich papers
- ACM Digital Library and IEEE Xplore references in search results
- Conference proceedings: ICSE, SOSP, OSDI, VLDB, SIGMOD, USENIX ATC

## What to Look For

- Novel algorithms or data structures that solve problems described in the spec
- Distributed systems patterns (consensus, replication, partitioning) if the spec involves multi-node systems
- Recent papers on testing strategies, formal verification, or reliability engineering
- Concurrency and parallelism research relevant to the spec's runtime
- Known failure modes or anti-patterns documented in systems research

## What to Skip

- Textbook CS material (sorting algorithms, basic data structures, intro networking)
- Papers on ML/AI unless the spec explicitly involves machine learning
- Purely theoretical work with no clear path to production implementation
```

Write `src/flavours/software-engineering/researchers/ecosystem.md`:

```markdown
---
name: ecosystem
description: Researches latest framework documentation, library releases, package updates, and tooling for software projects
perspective: ecosystem
---

You are the Ecosystem Research Specialist for a software engineering project. Focus on the specific technologies in the spec and constraints — their latest versions, new APIs, deprecation notices, migration guides, and ecosystem tooling.

## Where to Search

- Official documentation for the framework/runtime in constraints.md
- GitHub release notes and changelogs for key dependencies
- Package registry (npm, PyPI, crates.io, etc.) for version updates
- Framework migration guides if newer major versions exist
- Official performance benchmarks and tuning guides

## What to Look For

- New APIs or features in the specified framework that could replace custom code in the spec
- Breaking changes or deprecations that affect the planned approach
- Built-in middleware, plugins, or modules that remove the need for third-party dependencies
- Performance best practices recommended by framework maintainers
- Security advisories or CVEs affecting specified dependencies

## What to Skip

- Version history older than the currently specified versions
- Alternative frameworks (the constraints are settled — focus on the chosen stack)
- Community blog posts when official documentation covers the same topic
```

Write `src/flavours/software-engineering/researchers/competitive.md`:

```markdown
---
name: competitive
description: Investigates how other software projects and tools solve similar engineering problems
perspective: competitive
---

You are the Competitive Research Specialist for a software engineering project. Focus on understanding how other projects, libraries, and tools approach the same problem space as the spec.

## Where to Search

- GitHub repositories solving similar problems (sort by stars, recent activity)
- "Awesome" lists for the relevant technology domain
- Developer comparison posts and architectural decision records (ADRs)
- Stack Overflow discussions about trade-offs in this problem space
- Hacker News and Reddit threads discussing similar tools

## What to Look For

- API designs that feel particularly ergonomic or well-considered
- Architectural patterns other projects chose and their documented trade-offs
- Error handling and edge case strategies that proved effective
- Testing approaches (property-based testing, snapshot testing, integration test harnesses)
- Performance characteristics and scalability decisions
- Anti-patterns or post-mortems from similar projects

## What to Skip

- Superficial feature comparisons without architectural insight
- Projects using fundamentally different technology stacks unless the pattern transfers
- Abandoned projects (unless the lessons learned are documented)
```

Write `src/flavours/software-engineering/core/researcher.md` — same structure as the generic `researcher.md` but the synthesis guidelines should emphasize production readiness, API design quality, and engineering trade-offs.

Write `src/flavours/software-engineering/core/refiner.md` — same structure as the generic `refiner.md` but refinement guidelines should emphasize that the spec describes behaviors and outcomes, never implementation steps, and that constraints.md is immutable.

- [ ] **Step 2: Create remaining 12 flavour researcher directories**

For each remaining flavour, create `researchers/` with three specialists + update `core/researcher.md` and `core/refiner.md`. Each follows the same pattern as software-engineering but with domain-specific focus:

| Flavour | Academic Focus | Ecosystem Focus | Competitive Focus |
|---------|---------------|-----------------|-------------------|
| `data-analysis` | Statistical methods, visualization research, data quality papers | Pandas, Polars, DuckDB, Jupyter, plotting libraries | Tableau, Metabase, Observable, similar analysis tools |
| `game-dev` | Real-time rendering, physics simulation, procedural generation, game AI | Unity, Unreal, Godot, game framework releases | Indie games solving similar mechanics, GDC talks |
| `legal-drafting` | Computational law, contract analysis, NLP for legal text | Legal tech APIs, document assembly tools, e-signature platforms | DocuSign CLM, Ironclad, ContractPodAi, legal SaaS |
| `machine-learning` | Latest ML papers (transformers, RL, optimization), MLOps research | PyTorch, TensorFlow, JAX, MLflow, Weights & Biases releases | Competing ML platforms, AutoML tools, model serving |
| `mobile-app` | Mobile HCI research, battery/performance studies, accessibility | React Native, Flutter, SwiftUI, Kotlin Multiplatform releases | Competing apps, App Store/Play Store design patterns |
| `music-composition` | Music information retrieval, algorithmic composition, audio DSP | Web Audio API, Tone.js, MIDI.js, DAW plugin SDKs | Ableton, MuseScore, Sonic Pi, similar composition tools |
| `novel-writing` | Narrative theory, computational creativity, story structure research | Writing tool APIs, markdown rendering, export formats | Scrivener, Ulysses, novelWriter, story structure tools |
| `screenwriting` | Screenplay structure research, dialogue studies, film theory | Fountain format, screenplay APIs, format specifications | Final Draft, WriterSolo, Highland, screenplay tools |
| `security-audit` | CVE databases, vulnerability research, threat modeling papers | OWASP updates, security scanner releases, CVE feeds | Snyk, SonarQube, Semgrep, competing audit tools |
| `technical-writing` | Documentation usability research, information architecture | Docs-as-code tools, MDX, Docusaurus, Sphinx releases | Stripe docs, Vercel docs, exemplary documentation sites |
| `test-suite` | Test theory, mutation testing, property-based testing research | Testing framework releases (Jest, Vitest, pytest, etc.) | Testing tools, coverage platforms, CI testing patterns |
| `translation` | Machine translation research, localization studies, CAT tool research | i18n libraries, ICU MessageFormat, CLDR updates | DeepL, Crowdin, Lokalise, translation management tools |

Each flavour's specialists should follow the same markdown frontmatter pattern. The prompt body should be 10-20 lines focusing on domain-specific search targets, what to look for, and what to skip — matching the level of specificity shown in the software-engineering example above.

The core `researcher.md` for each flavour should tailor synthesis guidelines to the domain (e.g., ML researcher should prioritize reproducibility; security-audit researcher should prioritize severity).

The core `refiner.md` for each flavour should tailor refinement guidelines to the domain's spec conventions (e.g., game-dev refiner should preserve game state specifications; ML refiner should not add training hyperparameters to the spec).

- [ ] **Step 3: Commit all flavour researchers**

```bash
git add src/flavours/*/researchers/ src/flavours/*/core/researcher.md src/flavours/*/core/refiner.md
git commit -m "feat: add flavour-specific research specialists and core agents for all 13 flavours"
```

---

### Task 6: Create Core Researcher Synthesizer Agent

**Files:**

- Create: `src/agents/core/researcher.md`

This agent synthesizes findings from the research specialists into a single `research.md` document.

- [ ] **Step 1: Create the researcher synthesizer prompt**

Write `src/agents/core/researcher.md`:

````markdown
---
name: researcher
description: Synthesizes research findings from specialist agents into a unified report
model: opus
---

You are the Research Synthesizer. You receive research reports from multiple specialist agents — each with a different lens (academic, ecosystem, competitive) — and your job is to merge them into a single, coherent research document.

## Your Inputs

You receive:
- The current **spec.md** being researched
- Research reports from each specialist

## Your Task

Write a unified `research.md` file to the build directory. Use the Write tool.

## Output Structure

Structure research.md as follows:

```
# Research Findings

> Research conducted on [date] for spec: [spec title]

## Key Recommendations

Bullet list of the 3-5 most impactful recommendations, each in one sentence.

## Detailed Findings

### [Topic/Theme 1]

**Source:** [URL or citation]
**Perspective:** [which specialist found this]
**Relevance:** [why this matters to the spec]
**Recommendation:** [what should change in the spec]

### [Topic/Theme 2]
...

## Sources

Numbered list of all URLs and citations referenced above.
```

## Synthesis Guidelines

- **Deduplicate**: If multiple specialists found the same thing, merge into one finding and note the convergence.
- **Resolve conflicts**: If specialists disagree, present both views with trade-offs. Do not silently pick one.
- **Rank by impact**: Order findings by how much they could improve the spec, most impactful first.
- **Be concrete**: Every recommendation should be specific enough that someone could act on it without further research.
- **Preserve sources**: Always include the URL or citation. The user needs to verify your work.
- **Stay scoped**: Only include findings relevant to the spec. Don't pad with tangentially related material.

When there is only one specialist report (quick mode), organize and refine it rather than just passing it through. Add structure, verify claims are sourced, and sharpen recommendations.
````

- [ ] **Step 2: Commit**

```bash
git add src/agents/core/researcher.md
git commit -m "feat: add researcher synthesizer agent prompt"
```

---

### Task 7: Create Core Refiner Agent

**Files:**

- Create: `src/agents/core/refiner.md`

This agent reads `research.md` and `spec.md` and produces a revised `spec.md`.

- [ ] **Step 1: Create the refiner agent prompt**

Write `src/agents/core/refiner.md`:

```markdown
---
name: refiner
description: Merges research findings into a spec, producing a revised spec.md
model: opus
---

You are the Spec Refiner. You receive a spec.md and a research.md, and your job is to produce a revised spec.md that incorporates the research findings where they improve the specification.

## Your Inputs

- **spec.md** — the current specification
- **research.md** — research findings with recommendations
- **constraints.md** — technical constraints (do not modify these)
- **taste.md** (optional) — style preferences (do not modify these)

## Your Task

Rewrite spec.md incorporating research findings. Use the Write tool to overwrite the existing spec.md file.

## Refinement Guidelines

- **Additive by default**: Add new insights, edge cases, or approaches the research uncovered. Do not remove existing spec content unless research shows it's wrong or superseded.
- **Preserve structure**: Keep the same markdown structure and section ordering as the original spec. Add subsections if needed.
- **Cite sources inline**: When adding content from research, include a brief inline note like "(per [source])" so the user knows which changes came from research.
- **Stay within scope**: Do not expand the spec's scope boundaries. Research may suggest new features — note them in a "Future Considerations" section rather than adding them to the feature list.
- **Constraints are immutable**: Never modify constraints.md or taste.md. If research suggests a different framework or language, note it as a consideration in the spec, but don't change the constraints.
- **Flag conflicts**: If research contradicts an existing spec decision, keep the original decision but add a note explaining the alternative and trade-offs.

## What NOT to do

- Do not rewrite the spec from scratch — revise it.
- Do not add implementation details — the spec describes what, not how.
- Do not remove features the user explicitly specified.
- Do not modify constraints.md or taste.md.
```

- [ ] **Step 2: Commit**

```bash
git add src/agents/core/refiner.md
git commit -m "feat: add refiner agent prompt for spec revision"
```

---

### Task 8: Create Research Executor

**Files:**

- Create: `src/engine/pipeline/research.exec.ts`

This file mirrors the pattern of `specify.exec.ts` — it's a thin wrapper around `invokeEnsemble` configured for research.

- [ ] **Step 1: Create research.exec.ts**

Write `src/engine/pipeline/research.exec.ts`:

```typescript
import * as fs from "node:fs"
import * as path from "node:path"
import { EnsembleResult } from "../../types"
import { invokeEnsemble } from "./ensemble.exec"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { resolveFlavour } from "../discovery/flavour.resolve"

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/** Build a research specialist system prompt from shared context + overlay. */
const buildResearchSpecialistPrompt = (context: string, overlay: string): string => {
  return `${context}\n\n${overlay}`
}

/** Assemble the user prompt for a research specialist. */
const assembleSpecialistUserPrompt = (specMd: string, constraintsMd: string, tasteMd: string | null): string => {
  const sections: string[] = []

  sections.push("## spec.md\n")
  sections.push(specMd)
  sections.push("")

  sections.push("## constraints.md\n")
  sections.push(constraintsMd)
  sections.push("")

  if (tasteMd) {
    sections.push("## taste.md\n")
    sections.push(tasteMd)
    sections.push("")
  }

  sections.push("Research this spec thoroughly using your web tools. Produce a markdown research report as your response.")

  return sections.join("\n")
}

/** Assemble the user prompt for the research synthesizer. */
const assembleSynthesizerUserPrompt = (
  specMd: string,
  buildDir: string,
  drafts: { perspective: string; draft: string }[],
): string => {
  const sections: string[] = []

  sections.push("## spec.md\n")
  sections.push(specMd)
  sections.push("")

  sections.push("## Specialist Research Reports\n")
  for (const { perspective, draft } of drafts) {
    sections.push(`### ${perspective.charAt(0).toUpperCase() + perspective.slice(1)} Specialist Report\n`)
    sections.push(draft)
    sections.push("\n---\n")
  }

  sections.push("## Output\n")
  sections.push(`Write the synthesized research report to: ${buildDir}/research.md`)
  sections.push("Use the Write tool to create the file.")

  return sections.join("\n")
}

// ---------------------------------------------------------------------------
// Research ensemble
// ---------------------------------------------------------------------------

export type ResearchConfig = {
  model: string
  timeoutMinutes: number
  maxBudgetUsd: number | null
  buildDir: string
  flavour: string | null
  isDeep: boolean
  networkAllowlist: string[]
  sandboxProvider?: import("../../types").RidgelineConfig["sandboxProvider"]
}

export const invokeResearcher = async (
  specMd: string,
  constraintsMd: string,
  tasteMd: string | null,
  config: ResearchConfig,
): Promise<EnsembleResult> => {
  const registry = buildAgentRegistry(resolveFlavour(config.flavour))
  const context = registry.getContext("researchers") ?? ""
  const allSpecialists = registry.getSpecialists("researchers")

  // Quick mode: use only the first specialist (ecosystem by default — most broadly useful)
  // Deep mode: use all specialists
  const specialists = config.isDeep
    ? allSpecialists
    : allSpecialists.length > 0
      ? [allSpecialists[0]]
      : []

  return invokeEnsemble<string>({
    label: "Researching",
    specialists,
    isStructured: false,

    buildSpecialistPrompt: (overlay) => buildResearchSpecialistPrompt(context, overlay),
    specialistUserPrompt: assembleSpecialistUserPrompt(specMd, constraintsMd, tasteMd),
    specialistSchema: "", // unused when isStructured is false
    specialistTools: ["WebFetch", "WebSearch", "Bash"],

    synthesizerPrompt: registry.getCorePrompt("researcher.md"),
    buildSynthesizerUserPrompt: (drafts) =>
      assembleSynthesizerUserPrompt(specMd, config.buildDir, drafts),
    synthesizerTools: ["Write"],

    model: config.model,
    timeoutMinutes: config.timeoutMinutes,
    maxBudgetUsd: config.maxBudgetUsd,
    networkAllowlist: config.networkAllowlist,
    sandboxProvider: config.sandboxProvider,

    verify: () => {
      if (!fs.existsSync(path.join(config.buildDir, "research.md"))) {
        throw new Error("Synthesizer did not create research.md")
      }
    },
  })
}
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/engine/pipeline/research.exec.ts
git commit -m "feat: add research ensemble executor"
```

---

### Task 9: Create Refine Executor

**Files:**

- Create: `src/engine/pipeline/refine.exec.ts`

The refine executor is simpler — a single Claude invocation (no ensemble) that reads `research.md` + `spec.md` and rewrites `spec.md`.

- [ ] **Step 1: Create refine.exec.ts**

Write `src/engine/pipeline/refine.exec.ts`:

```typescript
import * as fs from "node:fs"
import * as path from "node:path"
import { ClaudeResult } from "../../types"
import { invokeClaude } from "../claude/claude.exec"
import { createDisplayCallbacks } from "../claude/stream.display"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { resolveFlavour } from "../discovery/flavour.resolve"
import { createStderrHandler } from "./pipeline.shared"

// ---------------------------------------------------------------------------
// Refine executor
// ---------------------------------------------------------------------------

export type RefineConfig = {
  model: string
  timeoutMinutes: number
  buildDir: string
  flavour: string | null
}

export const invokeRefiner = async (
  specMd: string,
  researchMd: string,
  constraintsMd: string,
  tasteMd: string | null,
  config: RefineConfig,
): Promise<ClaudeResult> => {
  const registry = buildAgentRegistry(resolveFlavour(config.flavour))
  const systemPrompt = registry.getCorePrompt("refiner.md")

  const sections: string[] = []

  sections.push("## spec.md\n")
  sections.push(specMd)
  sections.push("")

  sections.push("## research.md\n")
  sections.push(researchMd)
  sections.push("")

  sections.push("## constraints.md\n")
  sections.push(constraintsMd)
  sections.push("")

  if (tasteMd) {
    sections.push("## taste.md\n")
    sections.push(tasteMd)
    sections.push("")
  }

  sections.push("## Output\n")
  sections.push(`Rewrite the spec incorporating research findings. Write the revised spec to: ${config.buildDir}/spec.md`)
  sections.push("Use the Write tool to overwrite the existing file.")

  const userPrompt = sections.join("\n")

  const { onStdout, flush } = createDisplayCallbacks({ projectRoot: process.cwd() })

  let result: ClaudeResult
  try {
    result = await invokeClaude({
      systemPrompt,
      userPrompt,
      model: config.model,
      allowedTools: ["Read", "Write"],
      cwd: process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      onStdout,
      onStderr: createStderrHandler("refiner"),
    })
  } finally {
    flush()
  }

  // Verify spec.md was rewritten
  if (!fs.existsSync(path.join(config.buildDir, "spec.md"))) {
    throw new Error("Refiner did not write spec.md")
  }

  return result
}
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/engine/pipeline/refine.exec.ts
git commit -m "feat: add refine executor for merging research into spec"
```

---

### Task 10: Create Research Command

**Files:**

- Create: `src/commands/research.ts`

Handles `ridgeline research <build> [--deep] [--auto [N]]`. This is the main entry point for the research stage.

- [ ] **Step 1: Create research.ts**

Write `src/commands/research.ts`:

```typescript
import * as fs from "node:fs"
import * as path from "node:path"
import { printInfo, printError } from "../ui/output"
import { invokeResearcher, ResearchConfig } from "../engine/pipeline/research.exec"
import { invokeRefiner, RefineConfig } from "../engine/pipeline/refine.exec"
import { advancePipeline } from "../stores/state"
import { logTrajectory, makeTrajectoryEntry } from "../stores/trajectory"
import { recordCost } from "../stores/budget"
import { resolveResearchAllowlist } from "../stores/settings"

export type ResearchOptions = {
  model: string
  timeout: number
  maxBudgetUsd?: number
  flavour?: string
  isDeep: boolean
  auto: number | null
}

const readBuildFile = (buildDir: string, filename: string): string | null => {
  const fp = path.join(buildDir, filename)
  return fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : null
}

const runSingleResearch = async (buildName: string, buildDir: string, opts: ResearchOptions): Promise<void> => {
  const specMd = readBuildFile(buildDir, "spec.md")
  if (!specMd) {
    printError(`spec.md not found. Run 'ridgeline spec ${buildName}' first.`)
    return
  }

  const constraintsMd = readBuildFile(buildDir, "constraints.md")
  if (!constraintsMd) {
    printError(`constraints.md not found. Run 'ridgeline spec ${buildName}' first.`)
    return
  }

  const tasteMd = readBuildFile(buildDir, "taste.md")
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")

  const config: ResearchConfig = {
    model: opts.model,
    timeoutMinutes: opts.timeout,
    maxBudgetUsd: opts.maxBudgetUsd ?? null,
    buildDir,
    flavour: opts.flavour ?? null,
    isDeep: opts.isDeep,
    networkAllowlist: resolveResearchAllowlist(ridgelineDir),
  }

  logTrajectory(buildDir, makeTrajectoryEntry("research_start", null,
    `Research started (${opts.isDeep ? "deep" : "quick"} mode)`))

  const result = await invokeResearcher(specMd, constraintsMd, tasteMd, config)

  // Record costs
  for (let i = 0; i < result.specialistResults.length; i++) {
    recordCost(buildDir, "research", "researcher", i, result.specialistResults[i])
  }
  recordCost(buildDir, "research", "synthesizer", 0, result.synthesizerResult)

  logTrajectory(buildDir, makeTrajectoryEntry("research_complete", null,
    `Research complete (${result.specialistResults.length} specialists)`, {
      duration: result.totalDurationMs,
      tokens: {
        input: result.specialistResults.reduce((sum, r) => sum + r.usage.inputTokens, 0) + result.synthesizerResult.usage.inputTokens,
        output: result.specialistResults.reduce((sum, r) => sum + r.usage.outputTokens, 0) + result.synthesizerResult.usage.outputTokens,
      },
      costUsd: result.totalCostUsd,
    }))

  advancePipeline(buildDir, buildName, "research")

  printInfo(`\nResearch complete: ${result.specialistResults.length} specialist(s) + synthesizer`)
  printInfo(`Cost: $${result.totalCostUsd.toFixed(2)}`)
  printInfo(`Output: ${path.join(buildDir, "research.md")}`)
}

const runSingleRefine = async (buildName: string, buildDir: string, opts: ResearchOptions): Promise<void> => {
  const specMd = readBuildFile(buildDir, "spec.md")
  const researchMd = readBuildFile(buildDir, "research.md")
  const constraintsMd = readBuildFile(buildDir, "constraints.md")

  if (!specMd || !researchMd || !constraintsMd) {
    printError("Missing spec.md, research.md, or constraints.md for refine.")
    return
  }

  const tasteMd = readBuildFile(buildDir, "taste.md")

  const config: RefineConfig = {
    model: opts.model,
    timeoutMinutes: opts.timeout,
    buildDir,
    flavour: opts.flavour ?? null,
  }

  logTrajectory(buildDir, makeTrajectoryEntry("refine_start", null, "Refine started"))

  const result = await invokeRefiner(specMd, researchMd, constraintsMd, tasteMd, config)

  recordCost(buildDir, "refine", "refiner", 0, result)

  logTrajectory(buildDir, makeTrajectoryEntry("refine_complete", null, "Refine complete", {
    duration: result.durationMs,
    tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens },
    costUsd: result.costUsd,
  }))

  advancePipeline(buildDir, buildName, "refine")

  printInfo(`\nSpec refined. Cost: $${result.costUsd.toFixed(2)}`)
}

export const runResearch = async (buildName: string, opts: ResearchOptions): Promise<void> => {
  const buildDir = path.join(process.cwd(), ".ridgeline", "builds", buildName)

  if (!fs.existsSync(buildDir)) {
    printError(`Build directory not found: ${buildDir}`)
    return
  }

  if (opts.auto !== null) {
    // Auto mode: research → refine → research → refine ... for N iterations
    const iterations = opts.auto
    printInfo(`Auto-research: ${iterations} iteration(s) (${opts.isDeep ? "deep" : "quick"} mode)\n`)

    for (let i = 1; i <= iterations; i++) {
      printInfo(`--- Iteration ${i} of ${iterations} ---\n`)

      await runSingleResearch(buildName, buildDir, opts)
      await runSingleRefine(buildName, buildDir, opts)

      if (i < iterations) {
        printInfo("") // blank line between iterations
      }
    }

    printInfo(`\nAuto-research complete: ${iterations} iteration(s)`)
    printInfo(`Spec has been refined ${iterations} time(s).`)
    console.log("")
    printInfo(`Review: ${path.join(buildDir, "spec.md")}`)
    printInfo(`Next: ridgeline plan ${buildName}`)
  } else {
    // Manual mode: just run research, user will run refine separately
    await runSingleResearch(buildName, buildDir, opts)
    console.log("")
    printInfo("Review and edit research.md, then run:")
    printInfo(`  ridgeline refine ${buildName}`)
  }
}
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/commands/research.ts
git commit -m "feat: add research command with quick/deep/auto modes"
```

---

### Task 11: Create Refine Command

**Files:**

- Create: `src/commands/refine.ts`

Standalone command for `ridgeline refine <build>`.

- [ ] **Step 1: Create refine.ts**

Write `src/commands/refine.ts`:

```typescript
import * as fs from "node:fs"
import * as path from "node:path"
import { printInfo, printError } from "../ui/output"
import { invokeRefiner, RefineConfig } from "../engine/pipeline/refine.exec"
import { advancePipeline } from "../stores/state"
import { logTrajectory, makeTrajectoryEntry } from "../stores/trajectory"
import { recordCost } from "../stores/budget"

export type RefineOptions = {
  model: string
  timeout: number
  flavour?: string
}

export const runRefine = async (buildName: string, opts: RefineOptions): Promise<void> => {
  const buildDir = path.join(process.cwd(), ".ridgeline", "builds", buildName)

  if (!fs.existsSync(buildDir)) {
    printError(`Build directory not found: ${buildDir}`)
    return
  }

  const specPath = path.join(buildDir, "spec.md")
  const researchPath = path.join(buildDir, "research.md")
  const constraintsPath = path.join(buildDir, "constraints.md")

  if (!fs.existsSync(specPath)) {
    printError(`spec.md not found. Run 'ridgeline spec ${buildName}' first.`)
    return
  }
  if (!fs.existsSync(researchPath)) {
    printError(`research.md not found. Run 'ridgeline research ${buildName}' first.`)
    return
  }
  if (!fs.existsSync(constraintsPath)) {
    printError(`constraints.md not found. Run 'ridgeline spec ${buildName}' first.`)
    return
  }

  const specMd = fs.readFileSync(specPath, "utf-8")
  const researchMd = fs.readFileSync(researchPath, "utf-8")
  const constraintsMd = fs.readFileSync(constraintsPath, "utf-8")
  const tastePath = path.join(buildDir, "taste.md")
  const tasteMd = fs.existsSync(tastePath) ? fs.readFileSync(tastePath, "utf-8") : null

  const config: RefineConfig = {
    model: opts.model,
    timeoutMinutes: opts.timeout,
    buildDir,
    flavour: opts.flavour ?? null,
  }

  logTrajectory(buildDir, makeTrajectoryEntry("refine_start", null, "Refine started"))

  const result = await invokeRefiner(specMd, researchMd, constraintsMd, tasteMd, config)

  recordCost(buildDir, "refine", "refiner", 0, result)

  logTrajectory(buildDir, makeTrajectoryEntry("refine_complete", null, "Refine complete", {
    duration: result.durationMs,
    tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens },
    costUsd: result.costUsd,
  }))

  advancePipeline(buildDir, buildName, "refine")

  printInfo(`\nSpec refined with research findings.`)
  printInfo(`Cost: $${result.costUsd.toFixed(2)}`)
  console.log("")
  printInfo(`Review: ${path.join(buildDir, "spec.md")}`)
  printInfo(`Next: ridgeline plan ${buildName}`)
}
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/commands/refine.ts
git commit -m "feat: add refine command for merging research into spec"
```

---

### Task 12: Register Commands in CLI

**Files:**

- Modify: `src/cli.ts`

Add `research` and `refine` commands to the CLI.

- [ ] **Step 1: Add imports**

At the top of `src/cli.ts`, add:

```typescript
import { runResearch } from "./commands/research"
import { runRefine } from "./commands/refine"
```

- [ ] **Step 2: Add research command after the spec command block (after line 129)**

```typescript
program
  .command("research [build-name]")
  .description("Research the spec using web sources to find improvements (optional step between spec and plan)")
  .option("--model <name>", "Model for research agents", "opus")
  .option("--timeout <minutes>", "Max duration per agent in minutes", "15")
  .option("--max-budget-usd <n>", "Halt if cumulative research cost exceeds this amount")
  .option("--deep", "Run full ensemble (3 specialists) instead of quick single-agent research")
  .option("--auto [iterations]", "Auto-loop: research + refine for N iterations (default 3)")
  .option("--flavour <name-or-path>", "Agent flavour: built-in name or path to custom agents")
  .action(async (buildName: string | undefined, opts: Opts) => {
    try {
      const autoRaw = opts.auto
      let auto: number | null = null
      if (autoRaw !== undefined) {
        auto = autoRaw === true ? 3 : parseInt(String(autoRaw), 10)
        if (isNaN(auto) || auto < 1) auto = 3
      }

      await runResearch(await requireBuildName(buildName), {
        model: (opts.model as string) ?? "opus",
        timeout: parseInt(String(opts.timeout ?? "15"), 10),
        maxBudgetUsd: opts.maxBudgetUsd ? parseFloat(String(opts.maxBudgetUsd)) : undefined,
        flavour: (opts.flavour as string) ?? undefined,
        isDeep: opts.deep === true,
        auto,
      })
    } catch (err) {
      handleCommandError(err)
    }
  })
```

- [ ] **Step 3: Add refine command after the research command**

```typescript
program
  .command("refine [build-name]")
  .description("Merge research.md findings into spec.md")
  .option("--model <name>", "Model for refiner agent", "opus")
  .option("--timeout <minutes>", "Max duration in minutes", "10")
  .option("--flavour <name-or-path>", "Agent flavour: built-in name or path to custom agents")
  .action(async (buildName: string | undefined, opts: Opts) => {
    try {
      await runRefine(await requireBuildName(buildName), {
        model: (opts.model as string) ?? "opus",
        timeout: parseInt(String(opts.timeout ?? "10"), 10),
        flavour: (opts.flavour as string) ?? undefined,
      })
    } catch (err) {
      handleCommandError(err)
    }
  })
```

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: register research and refine commands in CLI"
```

---

### Task 13: Update Rewind Command and Create Command

**Files:**

- Modify: `src/commands/rewind.ts:7` (VALID_STAGES)
- Modify: `src/commands/rewind.ts:44` (status display)
- Modify: `src/commands/create.ts:25-30` (STAGE_LABELS)
- Modify: `src/commands/create.ts:48` (status display loop)

- [ ] **Step 1: Update rewind valid stages**

In `src/commands/rewind.ts`, update line 7:

```typescript
const VALID_STAGES: PipelineStage[] = ["shape", "spec", "research", "refine", "plan"]
```

Update the status display loop (line 44) to show all stages:

```typescript
const ALL_DISPLAY_STAGES: PipelineStage[] = ["shape", "spec", "research", "refine", "plan", "build"]

// ... inside runRewind, replace the for loop:
for (const stage of ALL_DISPLAY_STAGES) {
  const status = statusAfter[stage]
  const icon = status === "complete" ? "done" : status === "skipped" ? "skip" : "---"
  console.log(`  ${stage.padEnd(16)} ${icon}`)
}
```

- [ ] **Step 2: Update create command stage labels and display**

In `src/commands/create.ts`, update `STAGE_LABELS`:

```typescript
const STAGE_LABELS: Record<PipelineStage, string> = {
  shape: "shape.md",
  spec: "spec.md",
  research: "research.md",
  refine: "refine",
  plan: "phases/",
  build: "build",
}
```

Update the status display loop (line 48):

```typescript
const DISPLAY_STAGES: PipelineStage[] = ["shape", "spec", "research", "refine", "plan", "build"]

// ... inside runCreate, replace the for loop:
for (const stage of DISPLAY_STAGES) {
  const icon = STATUS_ICONS[status[stage]] ?? (status[stage] === "skipped" ? "skip" : "---")
  const label = STAGE_LABELS[stage]
  console.log(`  ${label.padEnd(16)} ${icon}`)
}
```

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/commands/rewind.ts src/commands/create.ts
git commit -m "feat: add research/refine to rewind targets and status display"
```

---

### Task 14: Update Help Documentation

**Files:**

- Modify: `docs/help.md`

- [ ] **Step 1: Read help.md to understand current structure**

Run: `cat docs/help.md | head -50`

- [ ] **Step 2: Add research and refine to the command reference**

Add entries for the new commands in the appropriate section of help.md, following the existing format. Include:

````markdown
### ridgeline research [build-name]

Research the spec using web sources. Optional step between `spec` and `plan`.

**Options:**
- `--deep` — Run full ensemble (3 specialists: academic, ecosystem, competitive) instead of quick single-agent mode
- `--auto [N]` — Auto-loop: research + refine for N iterations (default 3 if no number given)
- `--model <name>` — Model for research agents (default: opus)
- `--timeout <minutes>` — Max duration per agent (default: 15)
- `--max-budget-usd <n>` — Halt if cumulative research cost exceeds this amount
- `--flavour <name-or-path>` — Agent flavour

**Examples:**
```
ridgeline research my-build              # Quick research (1 agent)
ridgeline research my-build --deep       # Deep research (3 specialists)
ridgeline research my-build --auto       # 3 auto iterations
ridgeline research my-build --auto 5     # 5 auto iterations
ridgeline research my-build --deep --auto 2  # Deep + 2 auto iterations
```

### ridgeline refine [build-name]

Merge research.md findings into spec.md. Run after reviewing/editing research.md.

**Options:**
- `--model <name>` — Model for refiner agent (default: opus)
- `--timeout <minutes>` — Max duration (default: 10)
- `--flavour <name-or-path>` — Agent flavour
````

- [ ] **Step 3: Commit**

```bash
git add docs/help.md
git commit -m "docs: add research and refine commands to help reference"
```

---

### Task 15: Final Integration Test

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: PASS (no TypeScript errors)

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Verify CLI registration**

Run: `node dist/cli.js --help`
Expected: Shows `research` and `refine` in the command list.

Run: `node dist/cli.js research --help`
Expected: Shows `--deep`, `--auto`, `--model`, `--timeout`, `--max-budget-usd`, `--flavour` options.

Run: `node dist/cli.js refine --help`
Expected: Shows `--model`, `--timeout`, `--flavour` options.

- [ ] **Step 4: Verify agent discovery**

Run a quick check that the agent registry can discover research specialists:

```bash
node -e "
const { buildAgentRegistry } = require('./dist/engine/discovery/agent.registry');
const r = buildAgentRegistry(null);
const s = r.getSpecialists('researchers');
console.log('Researchers found:', s.length);
s.forEach(sp => console.log(' -', sp.perspective));
const ctx = r.getContext('researchers');
console.log('Context:', ctx ? 'found' : 'missing');
"
```

Expected:

```text
Researchers found: 3
 - academic
 - ecosystem
 - competitive
Context: found
```

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: final integration fixes for research and refine pipeline"
```
