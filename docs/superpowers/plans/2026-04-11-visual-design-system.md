# Visual Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visual design awareness across the full Ridgeline pipeline — shape detection, design.md artifact lifecycle, visual specifier specialist, and web-visual tool family plugin.

**Architecture:** Three interconnected systems compose to give Claude "design sense." A shape detection engine scans shape.md against JSON keyword registries and records matches in build state. A new `ridgeline design` command (reusing the shaper agent pattern) produces design.md at project and feature levels, injected into downstream pipeline stages alongside constraints and taste. When visual shapes match, a conditional 4th specialist joins the specifier ensemble, and the reviewer gets design-aware context plus a web-visual tool family plugin with graceful degradation.

**Tech Stack:** TypeScript, Vitest, Commander.js, Playwright (peer), axe-core (peer), Project Wallace (peer), Lighthouse (peer), pixelmatch (peer)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/shapes/web-visual.json` | Web visual shape definition — keywords, tool family, reviewer context |
| `src/shapes/game-visual.json` | Game visual shape definition (deferred, shipped as data only) |
| `src/shapes/print-layout.json` | Print layout shape definition (deferred, shipped as data only) |
| `src/shapes/detect.ts` | Load shape definitions from `src/shapes/`, scan text for keyword matches |
| `src/shapes/__tests__/detect.test.ts` | Tests for detection logic |
| `src/commands/design.ts` | `ridgeline design` command — design-focused shaper producing design.md |
| `src/commands/__tests__/design.test.ts` | Tests for design command |
| `src/agents/core/designer.md` | Design-focused shaper agent prompt |
| `src/agents/specifiers/visual-coherence.md` | Visual coherence specialist (loaded conditionally by name, excluded from auto-discovery via hardcoded filter) |
| `plugin/web-visual/plugin.json` | Plugin manifest for web-visual tool family |
| `plugin/web-visual/tools/screenshot.md` | Playwright screenshot tool agent |
| `plugin/web-visual/tools/css-audit.md` | Project Wallace CSS audit tool agent |
| `plugin/web-visual/tools/a11y-audit.md` | axe-core accessibility audit tool agent |
| `plugin/web-visual/tools/visual-diff.md` | pixelmatch visual diff tool agent |
| `plugin/web-visual/tools/lighthouse.md` | Lighthouse audit tool agent |

### Modified Files

| File | Changes |
|------|---------|
| `src/types.ts` | Add `"design"` to `PipelineStage`, `design` field to `PipelineState`, `matchedShapes` to `BuildState`, `design` field to `SpecifierDraft` |
| `src/stores/state.ts` | Handle `design` pipeline stage in defaults, derivation, rewind, and stage ordering |
| `src/engine/discovery/agent.registry.ts` | Add `visual-coherence.md` to specialist exclusion list; add `getSpecialist(subfolder, filename)` method for loading conditional specialists by name |
| `src/engine/pipeline/pipeline.shared.ts` | Add `appendDesign()` function |
| `src/engine/pipeline/specify.exec.ts` | Accept `matchedShapes`, conditionally add visual specialist, pass design context |
| `src/engine/pipeline/plan.exec.ts` | Inject design.md via `appendDesign()` |
| `src/engine/pipeline/build.exec.ts` | Inject design.md via `appendDesign()` |
| `src/engine/pipeline/review.exec.ts` | Inject design.md + matched shape reviewer context |
| `src/commands/shape.ts` | Run detection after shape output, record matches, auto-chain to design |
| `src/commands/spec.ts` | Read matchedShapes from state and pass to specifier |
| `src/commands/create.ts` | Add `"design"` to status display and stage routing |
| `src/cli.ts` | Register `ridgeline design` command |

---

## Task 1: Shape Definition Files

**Files:**

- Create: `src/shapes/web-visual.json`
- Create: `src/shapes/game-visual.json`
- Create: `src/shapes/print-layout.json`

These are pure data — no code, no tests. They ship with Ridgeline and are read by the detection engine (Task 2).

- [ ] **Step 1: Create `src/shapes/web-visual.json`**

```json
{
  "name": "web-visual",
  "keywords": [
    "UI", "frontend", "CSS", "responsive", "web app", "dashboard",
    "website", "landing page", "SPA", "component library", "design system",
    "Tailwind", "React", "Vue", "Svelte"
  ],
  "toolFamily": "web-visual",
  "reviewerContext": "Check responsive behavior at mobile/tablet/desktop viewports. Verify interactive states. Evaluate whitespace and visual breathing room. Check color contrast ratios."
}
```

- [ ] **Step 2: Create `src/shapes/game-visual.json`**

```json
{
  "name": "game-visual",
  "keywords": [
    "game", "sprite", "texture", "3D", "scene", "canvas",
    "WebGL", "Godot", "Unity", "Phaser"
  ],
  "toolFamily": "game-visual",
  "reviewerContext": "Verify asset dimensions match specification. Check color palette consistency. Validate sprite sheet layouts. Evaluate UI overlay legibility against game backgrounds."
}
```

- [ ] **Step 3: Create `src/shapes/print-layout.json`**

```json
{
  "name": "print-layout",
  "keywords": [
    "print", "PDF", "document", "brochure", "typography",
    "poster", "flyer", "report"
  ],
  "toolFamily": "print-layout",
  "reviewerContext": "Verify bleed and trim areas. Check font embedding. Validate resolution meets print DPI requirements. Evaluate typographic hierarchy and spacing consistency."
}
```

- [ ] **Step 4: Verify JSON is valid**

Run: `node -e "for (const f of ['web-visual','game-visual','print-layout']) { JSON.parse(require('fs').readFileSync('src/shapes/'+f+'.json','utf-8')); console.log(f+': valid') }"`
Expected: All three print "valid"

- [ ] **Step 5: Commit**

```bash
git add src/shapes/web-visual.json src/shapes/game-visual.json src/shapes/print-layout.json
git commit -m "$(cat <<'EOF'
feat: add shape definition files for visual detection

Ship web-visual, game-visual, and print-layout shape definitions as
JSON data in src/shapes/. Detection engine (next task) reads these
to identify visual concerns in shape.md output.
EOF
)"
```

---

## Task 2: Shape Detection Module

**Files:**

- Create: `src/shapes/__tests__/detect.test.ts`
- Create: `src/shapes/detect.ts`

The detection module loads all `.json` files from `src/shapes/`, scans input text for keyword matches (case-insensitive), and returns the list of matched shape definitions.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/shapes/__tests__/detect.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
    statSync: vi.fn(),
  }
})

import * as fs from "node:fs"
import { detectShapes, loadShapeDefinitions, ShapeDefinition } from "../detect"

beforeEach(() => vi.clearAllMocks())

const WEB_VISUAL: ShapeDefinition = {
  name: "web-visual",
  keywords: ["UI", "frontend", "CSS", "responsive", "dashboard"],
  toolFamily: "web-visual",
  reviewerContext: "Check responsive behavior.",
}

const GAME_VISUAL: ShapeDefinition = {
  name: "game-visual",
  keywords: ["game", "sprite", "canvas", "WebGL"],
  toolFamily: "game-visual",
  reviewerContext: "Verify asset dimensions.",
}

describe("loadShapeDefinitions", () => {
  it("loads all .json files from the shapes directory", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
    vi.mocked(fs.readdirSync).mockReturnValue(["web-visual.json", "game-visual.json", "readme.md"] as any)
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce(JSON.stringify(WEB_VISUAL))
      .mockReturnValueOnce(JSON.stringify(GAME_VISUAL))

    const defs = loadShapeDefinitions()

    expect(defs).toHaveLength(2)
    expect(defs[0].name).toBe("web-visual")
    expect(defs[1].name).toBe("game-visual")
  })

  it("skips non-json files", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
    vi.mocked(fs.readdirSync).mockReturnValue(["readme.md", "notes.txt"] as any)

    const defs = loadShapeDefinitions()
    expect(defs).toHaveLength(0)
  })

  it("skips malformed JSON files", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
    vi.mocked(fs.readdirSync).mockReturnValue(["bad.json"] as any)
    vi.mocked(fs.readFileSync).mockReturnValue("not valid json {{{")

    const defs = loadShapeDefinitions()
    expect(defs).toHaveLength(0)
  })
})

describe("detectShapes", () => {
  it("matches keywords case-insensitively", () => {
    const text = "This is a responsive dashboard with CSS styling"
    const matches = detectShapes(text, [WEB_VISUAL, GAME_VISUAL])

    expect(matches).toHaveLength(1)
    expect(matches[0].name).toBe("web-visual")
  })

  it("matches multiple shape categories", () => {
    const text = "A web game with canvas rendering and responsive UI"
    const matches = detectShapes(text, [WEB_VISUAL, GAME_VISUAL])

    expect(matches).toHaveLength(2)
    expect(matches.map((m) => m.name)).toContain("web-visual")
    expect(matches.map((m) => m.name)).toContain("game-visual")
  })

  it("returns empty array when no keywords match", () => {
    const text = "A CLI tool for processing data files"
    const matches = detectShapes(text, [WEB_VISUAL, GAME_VISUAL])

    expect(matches).toHaveLength(0)
  })

  it("matches multi-word keywords", () => {
    const text = "Building a single page web app"
    const defs: ShapeDefinition[] = [{
      name: "web-visual",
      keywords: ["web app"],
      toolFamily: "web-visual",
      reviewerContext: "",
    }]

    const matches = detectShapes(text, defs)
    expect(matches).toHaveLength(1)
  })

  it("handles empty text", () => {
    const matches = detectShapes("", [WEB_VISUAL])
    expect(matches).toHaveLength(0)
  })

  it("handles empty definitions array", () => {
    const matches = detectShapes("some text with UI", [])
    expect(matches).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shapes/__tests__/detect.test.ts`
Expected: FAIL — module `../detect` does not exist

- [ ] **Step 3: Write the implementation**

```typescript
// src/shapes/detect.ts
import * as fs from "node:fs"
import * as path from "node:path"

export type ShapeDefinition = {
  name: string
  keywords: string[]
  toolFamily: string
  reviewerContext: string
}

/** Resolve the shapes directory across dist and src layouts. */
const resolveShapesDir = (): string | null => {
  const candidates = [
    path.join(__dirname),                                    // src/shapes (dev)
    path.join(__dirname, "..", "shapes"),                     // dist/shapes
    path.join(__dirname, "..", "..", "src", "shapes"),        // dist fallback
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      // Verify it contains at least one .json file
      const hasJson = fs.readdirSync(dir).some((f) => f.endsWith(".json"))
      if (hasJson) return dir
    }
  }
  return null
}

/** Load all shape definitions from the shapes directory. */
export const loadShapeDefinitions = (): ShapeDefinition[] => {
  const shapesDir = resolveShapesDir()
  if (!shapesDir) return []

  const definitions: ShapeDefinition[] = []

  for (const entry of fs.readdirSync(shapesDir)) {
    if (!entry.endsWith(".json")) continue

    try {
      const content = fs.readFileSync(path.join(shapesDir, entry), "utf-8")
      const def = JSON.parse(content) as ShapeDefinition
      if (def.name && Array.isArray(def.keywords)) {
        definitions.push(def)
      }
    } catch {
      // Skip malformed files
    }
  }

  return definitions
}

/** Scan text against shape definitions, return all that match at least one keyword. */
export const detectShapes = (text: string, definitions: ShapeDefinition[]): ShapeDefinition[] => {
  if (!text || definitions.length === 0) return []

  const lowerText = text.toLowerCase()

  return definitions.filter((def) =>
    def.keywords.some((keyword) => lowerText.includes(keyword.toLowerCase()))
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shapes/__tests__/detect.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shapes/detect.ts src/shapes/__tests__/detect.test.ts
git commit -m "$(cat <<'EOF'
feat: add shape detection module

Loads .json shape definitions from src/shapes/ and scans text for
case-insensitive keyword matches. Multiple categories can match
simultaneously (e.g., a web game matches both web-visual and
game-visual).
EOF
)"
```

---

## Task 3: Build State Extensions

**Files:**

- Modify: `src/types.ts`
- Modify: `src/stores/state.ts`

Add `"design"` as a pipeline stage and `matchedShapes` to build state.

- [ ] **Step 1: Extend types**

In `src/types.ts`, update `PipelineStage`:

```typescript
// old
export type PipelineStage = "shape" | "spec" | "research" | "refine" | "plan" | "build"
// new
export type PipelineStage = "shape" | "design" | "spec" | "research" | "refine" | "plan" | "build"
```

Update `PipelineState`:

```typescript
// old
export type PipelineState = {
  shape: "pending" | "complete"
  spec: "pending" | "complete"
  research: "pending" | "complete" | "skipped"
  refine: "pending" | "complete" | "skipped"
  plan: "pending" | "complete"
  build: "pending" | "running" | "complete"
}
// new
export type PipelineState = {
  shape: "pending" | "complete"
  design: "pending" | "complete" | "skipped"
  spec: "pending" | "complete"
  research: "pending" | "complete" | "skipped"
  refine: "pending" | "complete" | "skipped"
  plan: "pending" | "complete"
  build: "pending" | "running" | "complete"
}
```

Update `BuildState`:

```typescript
// old
export type BuildState = {
  buildName: string
  startedAt: string
  pipeline: PipelineState
  phases: PhaseState[]
}
// new
export type BuildState = {
  buildName: string
  startedAt: string
  pipeline: PipelineState
  matchedShapes?: string[]
  phases: PhaseState[]
}
```

Extend `SpecifierDraft` — add optional `design` field after the existing `concerns` field:

```typescript
export type SpecifierDraft = {
  perspective: string
  spec: {
    title: string
    overview: string
    features: { name: string; description: string; acceptanceCriteria: string[] }[]
    scopeBoundaries: { inScope: string[]; outOfScope: string[] }
  }
  constraints: {
    language: string
    runtime: string
    framework: string | null
    directoryConventions: string
    namingConventions: string
    apiStyle: string | null
    database: string | null
    dependencies: string[]
    checkCommand: string
  }
  taste: {
    codeStyle: string[]
    testPatterns: string[]
    commitFormat: string | null
    commentStyle: string | null
  } | null
  tradeoffs: string
  concerns: string[]
  design?: {
    hardTokens?: string[]
    softGuidance?: string[]
    featureVisuals?: {
      feature: string
      criteria: string[]
    }[]
  } | null
}
```

- [ ] **Step 2: Update state defaults and derivation**

In `src/stores/state.ts`, update `DEFAULT_PIPELINE`:

```typescript
const DEFAULT_PIPELINE: PipelineState = {
  shape: "pending",
  design: "skipped",
  spec: "pending",
  research: "skipped",
  refine: "skipped",
  plan: "pending",
  build: "pending",
}
```

Update `derivePipelineFromArtifacts` — add design detection after shape:

```typescript
const derivePipelineFromArtifacts = (buildDir: string): PipelineState => {
  const hasShape = fs.existsSync(path.join(buildDir, "shape.md"))
  const hasDesign = fs.existsSync(path.join(buildDir, "design.md"))
  const hasSpec = fs.existsSync(path.join(buildDir, "spec.md"))
  const hasConstraints = fs.existsSync(path.join(buildDir, "constraints.md"))
  const hasResearch = fs.existsSync(path.join(buildDir, "research.md"))
  const phasesDir = path.join(buildDir, "phases")
  const hasPhases = fs.existsSync(phasesDir) &&
    fs.readdirSync(phasesDir).some((f) => f.endsWith(".md") && /^\d+-.+\.md$/.test(f))

  return {
    shape: hasShape ? "complete" : "pending",
    design: hasDesign ? "complete" : "skipped",
    spec: hasSpec && hasConstraints ? "complete" : "pending",
    research: hasResearch ? "complete" : "skipped",
    refine: hasResearch ? "complete" : "skipped",
    plan: hasPhases ? "complete" : "pending",
    build: "pending",
  }
}
```

Update `getPipelineStatus` — add design to the belt-and-suspenders check:

```typescript
export const getPipelineStatus = (buildDir: string): PipelineState => {
  const state = loadState(buildDir)
  const fromState = state?.pipeline ?? { ...DEFAULT_PIPELINE }
  const fromDisk = derivePipelineFromArtifacts(buildDir)

  return {
    shape: fromState.shape === "complete" && fromDisk.shape === "complete" ? "complete" : fromDisk.shape,
    design: fromState.design ?? "skipped",
    spec: fromState.spec === "complete" && fromDisk.spec === "complete" ? "complete" : fromDisk.spec,
    research: fromState.research ?? "skipped",
    refine: fromState.refine ?? "skipped",
    plan: fromState.plan === "complete" && fromDisk.plan === "complete" ? "complete" : fromDisk.plan,
    build: fromState.build === "pending" ? "pending" : fromState.build,
  }
}
```

Update `ALL_PIPELINE_STAGES` to include design:

```typescript
const ALL_PIPELINE_STAGES: PipelineStage[] = ["shape", "design", "spec", "research", "refine", "plan", "build"]
```

Note: `REQUIRED_PIPELINE_STAGES` stays unchanged — design is optional like research/refine.

Update `collectStageFiles` — add design case:

```typescript
case "design": {
  const fp = path.join(buildDir, "design.md")
  if (fs.existsSync(fp)) files.push(fp)
  break
}
```

Add this case right after the existing `"research"` case, before the `"spec"` case.

Update `advancePipeline` — the existing `else` branch handles non-build stages, which already covers `"design"` since `stage === "design"` falls through to `state.pipeline[stage] = "complete"`. However, design uses `"skipped"` | `"pending"` | `"complete"` — setting it to `"complete"` from either state works fine.

Update `resetPipelineState` — design is an optional stage, so add it alongside research/refine:

```typescript
if (stage === "research" || stage === "refine" || stage === "design") {
  state.pipeline[stage] = "skipped" as any
}
```

In the existing code at line ~248, change the condition from:

```typescript
if (stage === "research" || stage === "refine") {
```

to:

```typescript
if (stage === "research" || stage === "refine" || stage === "design") {
```

And the same pattern at line ~254:

```typescript
} else if (targetStage === "research" || targetStage === "refine") {
```

to:

```typescript
} else if (targetStage === "research" || targetStage === "refine" || targetStage === "design") {
```

- [ ] **Step 3: Add a state helper to record matched shapes**

In `src/stores/state.ts`, add:

```typescript
/** Record matched shape names in build state. */
export const recordMatchedShapes = (buildDir: string, buildName: string, shapes: string[]): void => {
  let state = loadState(buildDir)
  if (!state) {
    state = {
      buildName,
      startedAt: new Date().toISOString(),
      pipeline: { ...DEFAULT_PIPELINE },
      phases: [],
    }
  }
  state.matchedShapes = shapes
  saveState(buildDir, state)
}

/** Read matched shapes from build state. Returns empty array if none recorded. */
export const getMatchedShapes = (buildDir: string): string[] => {
  const state = loadState(buildDir)
  return state?.matchedShapes ?? []
}
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: No type errors. If there are errors, they'll be in files that reference `PipelineState` without the new `design` field — fix them in subsequent steps.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/stores/state.ts
git commit -m "$(cat <<'EOF'
feat: add design pipeline stage and matchedShapes to build state

Extends PipelineStage/PipelineState with optional "design" stage
(skipped by default, like research/refine). Adds matchedShapes to
BuildState for downstream stages to read. Adds SpecifierDraft.design
field for the visual coherence specialist.
EOF
)"
```

---

## Task 4: Agent Registry Extension

**Files:**

- Modify: `src/engine/discovery/agent.registry.ts`

Add `visual-coherence.md` to the specialist exclusion list (alongside `context.md` and `gaps.md`) and add a `getSpecialist()` method for loading it by name when visual shapes match.

- [ ] **Step 1: Write the failing test**

Create or extend `src/engine/discovery/__tests__/agent.registry.test.ts` (if it doesn't exist, create it). The key behaviors to test:

```typescript
// In the test file, add these test cases:
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock fs to control file discovery
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    existsSync: vi.fn(),
    statSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  }
})

import * as fs from "node:fs"

// Test through buildAgentRegistry since discoverSpecialistsInDir is not exported:
import { buildAgentRegistry } from "../agent.registry"

beforeEach(() => vi.clearAllMocks())

describe("getSpecialists excludes visual-coherence.md", () => {
  it("skips visual-coherence.md in specialist discovery", () => {
    // Mock the agents directory resolution
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
    vi.mocked(fs.readdirSync).mockReturnValue([
      "completeness.md",
      "clarity.md",
      "visual-coherence.md",
      "context.md",
      "gaps.md",
    ] as any)
    vi.mocked(fs.readFileSync).mockImplementation((filepath: any) => {
      const name = String(filepath)
      if (name.includes("completeness")) {
        return "---\nname: completeness\n---\nYou are the completeness specialist."
      }
      if (name.includes("clarity")) {
        return "---\nname: clarity\n---\nYou are the clarity specialist."
      }
      if (name.includes("visual-coherence")) {
        return "---\nname: visual-coherence\nperspective: visual-coherence\n---\nYou are the visual coherence specialist."
      }
      return ""
    })

    const registry = buildAgentRegistry(null)
    const specialists = registry.getSpecialists("specifiers")

    const names = specialists.map((s) => s.perspective)
    expect(names).toContain("completeness")
    expect(names).toContain("clarity")
    expect(names).not.toContain("visual-coherence")
  })
})

describe("getSpecialist loads a specific specialist by filename", () => {
  it("returns the specialist definition for a valid file", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
    vi.mocked(fs.readdirSync).mockReturnValue([] as any)
    vi.mocked(fs.readFileSync).mockReturnValue(
      "---\nname: visual-coherence\nperspective: visual-coherence\n---\nYou are the visual coherence specialist."
    )

    const registry = buildAgentRegistry(null)
    const specialist = registry.getSpecialist("specifiers", "visual-coherence.md")

    expect(specialist).not.toBeNull()
    expect(specialist!.perspective).toBe("visual-coherence")
    expect(specialist!.overlay).toContain("visual coherence specialist")
  })

  it("returns null when file does not exist", () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return !String(p).includes("nonexistent")
    })
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
    vi.mocked(fs.readdirSync).mockReturnValue([] as any)

    const registry = buildAgentRegistry(null)
    const specialist = registry.getSpecialist("specifiers", "nonexistent.md")

    expect(specialist).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/discovery/__tests__/agent.registry.test.ts`
Expected: FAIL — `getSpecialist` is not a function (doesn't exist yet), and `visual-coherence.md` is not excluded.

- [ ] **Step 3: Add `visual-coherence.md` to the exclusion list**

In `src/engine/discovery/agent.registry.ts`, in `getSpecialists`, update the exclude list:

```typescript
const getSpecialists = (subfolder: string): SpecialistDef[] => {
  const dir = resolveSubfolder(subfolder, flavourPath, defaultAgentsDir)
  if (!dir) return []
  return discoverSpecialistsInDir(dir, ["context.md", "gaps.md", "visual-coherence.md"])
}
```

- [ ] **Step 4: Add `getSpecialist` method to the registry**

In `src/engine/discovery/agent.registry.ts`, add a new method inside `buildAgentRegistry`:

```typescript
const getSpecialist = (subfolder: string, filename: string): SpecialistDef | null => {
  const dir = resolveSubfolder(subfolder, flavourPath, defaultAgentsDir)
  if (!dir) return null

  const filepath = path.join(dir, filename)
  if (!fs.existsSync(filepath)) return null

  try {
    const content = fs.readFileSync(filepath, "utf-8")
    const fm = parseFrontmatter(content)
    if (!fm) return null

    const perspectiveMatch = content.match(/^perspective:\s*(.+)$/m)
    const perspective = perspectiveMatch ? perspectiveMatch[1].trim() : fm.name

    const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim()
    if (!body) return null

    return { perspective, overlay: body }
  } catch {
    return null
  }
}
```

Update the `AgentRegistry` type to include the new method:

```typescript
type AgentRegistry = {
  getCorePrompt: (filename: string) => string
  getSpecialists: (subfolder: string) => SpecialistDef[]
  getSpecialist: (subfolder: string, filename: string) => SpecialistDef | null
  getContext: (subfolder: string) => string | null
  getGaps: (subfolder: string) => string | null
  getSubAgents: () => DiscoveredAgent[]
  getAgentsFlag: () => Record<string, { description: string; prompt: string; model?: string }>
}
```

And include it in the return statement:

```typescript
return { getCorePrompt, getSpecialists, getSpecialist, getContext, getGaps, getSubAgents, getAgentsFlag }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/engine/discovery/__tests__/agent.registry.test.ts`
Expected: PASS

- [ ] **Step 6: Run full typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: No errors (downstream code doesn't call `getSpecialist` yet)

- [ ] **Step 7: Commit**

```bash
git add src/engine/discovery/agent.registry.ts src/engine/discovery/__tests__/agent.registry.test.ts
git commit -m "$(cat <<'EOF'
feat: exclude visual-coherence from auto-discovery, add getSpecialist

visual-coherence.md is excluded from ensemble auto-discovery alongside
context.md and gaps.md. New getSpecialist(subfolder, filename) method
loads a specific specialist by name for conditional activation.
EOF
)"
```

---

## Task 5: Design.md Injection

**Files:**

- Modify: `src/engine/pipeline/pipeline.shared.ts`
- Modify: `src/engine/pipeline/__tests__/pipeline.shared.test.ts`

Add `appendDesign()` function that resolves and injects design.md from both project and feature levels.

- [ ] **Step 1: Write the failing test**

Add to `src/engine/pipeline/__tests__/pipeline.shared.test.ts`:

```typescript
import { appendDesign } from "../pipeline.shared"

describe("appendDesign", () => {
  it("injects feature-level design.md when it exists", () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => String(p).includes("builds"))
    vi.mocked(fs.readFileSync).mockReturnValue("feature design content")
    const sections: string[] = []

    appendDesign(sections, makeConfig())

    const joined = sections.join("\n")
    expect(joined).toContain("## Feature Design")
    expect(joined).toContain("feature design content")
  })

  it("injects project-level design.md when it exists", () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return String(p).includes("ridgeline/design.md") && !String(p).includes("builds")
    })
    vi.mocked(fs.readFileSync).mockReturnValue("project design content")
    const sections: string[] = []

    appendDesign(sections, makeConfig())

    const joined = sections.join("\n")
    expect(joined).toContain("## Project Design")
    expect(joined).toContain("project design content")
  })

  it("injects both levels when both exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
      if (String(p).includes("builds")) return "feature design"
      return "project design"
    })
    const sections: string[] = []

    appendDesign(sections, makeConfig())

    const joined = sections.join("\n")
    expect(joined).toContain("## Project Design")
    expect(joined).toContain("## Feature Design")
  })

  it("does nothing when no design.md exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const sections: string[] = []

    appendDesign(sections, makeConfig())

    expect(sections).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/pipeline/__tests__/pipeline.shared.test.ts`
Expected: FAIL — `appendDesign` is not exported

- [ ] **Step 3: Implement `appendDesign`**

In `src/engine/pipeline/pipeline.shared.ts`, add after `appendConstraintsAndTaste`:

```typescript
/**
 * Append design.md sections to a prompt sections array.
 * Checks both project-level (.ridgeline/design.md) and feature-level (buildDir/design.md).
 * Both can coexist — injected as separate labeled sections.
 */
export const appendDesign = (sections: string[], config: RidgelineConfig): void => {
  const projectDesignPath = path.join(config.ridgelineDir, "design.md")
  const featureDesignPath = path.join(config.buildDir, "design.md")

  const hasProject = fs.existsSync(projectDesignPath)
  const hasFeature = fs.existsSync(featureDesignPath)

  if (hasProject) {
    sections.push("## Project Design\n")
    sections.push(fs.readFileSync(projectDesignPath, "utf-8"))
    sections.push("")
  }

  if (hasFeature) {
    sections.push("## Feature Design\n")
    sections.push(fs.readFileSync(featureDesignPath, "utf-8"))
    sections.push("")
  }
}
```

Add `import * as path from "node:path"` at the top of the file if not already present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/pipeline/__tests__/pipeline.shared.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/pipeline/pipeline.shared.ts src/engine/pipeline/__tests__/pipeline.shared.test.ts
git commit -m "$(cat <<'EOF'
feat: add appendDesign for design.md injection into pipeline prompts

Resolves design.md at both project (.ridgeline/design.md) and feature
(buildDir/design.md) levels. Both can coexist as separate labeled
sections. Follows the same pattern as appendConstraintsAndTaste.
EOF
)"
```

---

## Task 6: Designer Agent Prompt

**Files:**

- Create: `src/agents/core/designer.md`

The designer agent reuses the shaper's Q&A pattern but asks design-focused questions. It produces freeform markdown, not structured JSON.

- [ ] **Step 1: Create `src/agents/core/designer.md`**

```markdown
---
name: designer
description: Design-focused intake agent that gathers visual design context through Q&A, producing design.md
model: opus
---

You are a design system shaper for Ridgeline. Your job is to establish the visual design language for a project or feature. You produce design.md — a freeform document that carries design system definitions through the pipeline.

You operate like the project shaper but your questions focus exclusively on visual design concerns.

## Your modes

### Q&A mode

The orchestrator sends you either:

- An initial context (existing design.md, shape.md, matched shape categories)
- Answers to your previous questions

You respond with structured JSON containing your understanding and follow-up questions.

**Critical UX rule: Always present every question to the user.** Even when you can answer a question from existing work, include it with a `suggestedAnswer` so the user can confirm or correct.

**Question progression by matched shape category:**

**For web-visual projects:**

Round 1 — Visual Foundation:
- Color palette: primary, secondary, accent, neutral scale. Any existing brand colors?
- Typography: font families (headings, body, mono), type scale, line heights
- Spacing system: base unit (4px? 8px?), spacing scale
- Responsive breakpoints: mobile, tablet, desktop widths

Round 2 — Component Patterns:
- Component style: rounded vs sharp corners, shadow depth, border usage
- Interactive states: hover, focus, active, disabled conventions
- Layout patterns: grid system, max content width, sidebar behavior
- Loading and empty states: skeleton screens, spinners, placeholder patterns

Round 3 — Accessibility & Polish:
- Accessibility level: WCAG AA or AAA? Specific contrast requirements?
- Motion: transitions, animations, reduced-motion preferences
- Dark mode: required? How should the palette adapt?
- Icon style: line, filled, specific icon set?

**For game-visual projects:**

Round 1 — Art Direction:
- Art style: pixel art, vector, 3D, hand-drawn, realistic
- Color palette: mood, saturation level, palette constraints
- Asset dimensions: sprite sizes, texture resolutions, canvas size

Round 2 — UI & HUD:
- HUD/overlay style: transparency, position, font choices
- Menu design: navigation patterns, transition styles
- In-game text: dialogue boxes, tooltips, damage numbers

**For print-layout projects:**

Round 1 — Document Foundation:
- Page size, margins, bleed areas
- Typography: font families, sizes for body and headings, leading
- Grid system: columns, gutters, baseline grid

Round 2 — Visual Elements:
- Image handling: resolution requirements, placement rules
- Color mode: CMYK, spot colors, any Pantone references
- Decorative elements: rules, borders, backgrounds

**How to ask:**

- 3-5 questions per round
- For any question answerable from existing context, include a `suggestedAnswer`
- Signal `ready: true` after covering all relevant categories

### Design output mode

The orchestrator sends a signal to produce the final design document. Respond with **freeform markdown** — NOT JSON.

Structure your output naturally with headings and sections. Include:

- **Hard tokens** where the user gave specific values: exact hex codes, pixel values, font names. Use imperative language: "must use", "always", "required".
- **Soft guidance** where the user gave directional preferences: "prefer", "lean toward", "generally". These are best-effort, not mandatory.

Example structure (adapt to the project):

```text

# Design System

## Colors

Primary: #2563EB (must use for all primary actions)
Secondary: #64748B
Accent: #F59E0B

Neutral scale: slate-50 through slate-900

Prefer muted, desaturated backgrounds. Avoid pure black (#000).

## Typography

Headings: Inter (required)
Body: Inter
Mono: JetBrains Mono

Scale: 12 / 14 / 16 / 20 / 24 / 30 / 36 / 48

## Spacing

Base unit: 8px (always use multiples of 8)
...

```text

The format is flexible — brand guidelines, informal notes, formal style guides are all valid.

## Rules

**Design.md is a living document.** Users may edit it by hand after you produce it. Don't over-structure — keep it readable and editable.

**Hard vs soft is inferred from language.** Specific values with imperative language are hard tokens. Directional language signals soft guidance. The pipeline uses this distinction for review severity.

**Respect existing design.md.** If one exists, read it as starting context. Offer to refine or extend, don't start from scratch unless asked.

**Stay in design territory.** Don't ask about code architecture, error handling, or implementation details. Those belong to the shaper and specifier.
```

- [ ] **Step 2: Verify the file is valid markdown with frontmatter**

Run: `head -5 src/agents/core/designer.md`
Expected: Shows the `---` delimited frontmatter with name, description, model fields.

- [ ] **Step 3: Commit**

```bash
git add src/agents/core/designer.md
git commit -m "$(cat <<'EOF'
feat: add designer agent prompt for design.md creation

Design-focused shaper that asks visual design questions informed by
matched shape categories and produces freeform markdown design.md
with hard tokens and soft guidance.
EOF
)"
```

---

## Task 7: Design Command

**Files:**

- Create: `src/commands/design.ts`
- Create: `src/commands/__tests__/design.test.ts`

The `ridgeline design` command reuses the shaper's Q&A pattern with the designer agent. It supports two modes: standalone (project-level) and build-context (feature-level, auto-chained from shape).

- [ ] **Step 1: Write the failing test**

```typescript
// src/commands/__tests__/design.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  }
})

vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_prompt: string, cb: (answer: string) => void) => cb("")),
    close: vi.fn(),
  })),
}))

vi.mock("../../engine/claude/claude.exec", () => ({
  invokeClaude: vi.fn(() => Promise.resolve({
    result: JSON.stringify({ ready: true, summary: "Design understood" }),
    sessionId: "sess-1",
    costUsd: 0.01,
    durationMs: 1000,
    success: true,
    usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  })),
}))

vi.mock("../../engine/claude/stream.display", () => ({
  createDisplayCallbacks: vi.fn(() => ({ onStdout: vi.fn(), flush: vi.fn() })),
}))

vi.mock("../../engine/discovery/agent.registry", () => ({
  buildAgentRegistry: vi.fn(() => ({
    getCorePrompt: vi.fn(() => "designer prompt"),
  })),
}))

vi.mock("../../engine/discovery/flavour.resolve", () => ({
  resolveFlavour: vi.fn(() => null),
}))

vi.mock("../../stores/state", () => ({
  advancePipeline: vi.fn(),
  loadState: vi.fn(() => null),
}))

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
}))

import { resolveDesignOutputPath } from "../design"

describe("resolveDesignOutputPath", () => {
  it("returns build-level path when buildDir is provided", () => {
    const result = resolveDesignOutputPath("/builds/my-build", "/ridgeline")
    expect(result).toBe("/builds/my-build/design.md")
  })

  it("returns project-level path when no buildDir", () => {
    const result = resolveDesignOutputPath(null, "/ridgeline")
    expect(result).toBe("/ridgeline/design.md")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/__tests__/design.test.ts`
Expected: FAIL — module `../design` does not exist

- [ ] **Step 3: Implement the design command**

```typescript
// src/commands/design.ts
import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import { printInfo, printError } from "../ui/output"
import { invokeClaude } from "../engine/claude/claude.exec"
import { buildAgentRegistry } from "../engine/discovery/agent.registry"
import { resolveFlavour } from "../engine/discovery/flavour.resolve"
import { createDisplayCallbacks } from "../engine/claude/stream.display"
import { advancePipeline } from "../stores/state"

const MAX_CLARIFICATION_ROUNDS = 4

const QA_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    ready: { type: "boolean" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          suggestedAnswer: { type: "string" },
        },
        required: ["question"],
      },
    },
    summary: { type: "string" },
  },
  required: ["ready"],
})

type QAQuestion = {
  question: string
  suggestedAnswer?: string
}

type QAResponse = {
  ready: boolean
  questions?: (string | QAQuestion)[]
  summary?: string
}

const normalizeQuestion = (q: string | QAQuestion): QAQuestion =>
  typeof q === "string" ? { question: q } : q

const parseQAResponse = (resultText: string): QAResponse => {
  try {
    return JSON.parse(resultText)
  } catch {
    return { ready: true, summary: resultText }
  }
}

const askQuestion = (rl: readline.Interface, prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => {
      resolve(answer.trim())
    })
  })
}

/** Determine where to write design.md. */
export const resolveDesignOutputPath = (
  buildDir: string | null,
  ridgelineDir: string,
): string => {
  if (buildDir) return path.join(buildDir, "design.md")
  return path.join(ridgelineDir, "design.md")
}

export type DesignOptions = {
  model: string
  timeout: number
  flavour?: string
  matchedShapes?: string[]
}

export const runDesign = async (
  buildName: string | null,
  opts: DesignOptions
): Promise<void> => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const buildDir = buildName
    ? path.join(ridgelineDir, "builds", buildName)
    : null

  const outputPath = resolveDesignOutputPath(buildDir, ridgelineDir)
  const timeoutMs = opts.timeout * 60 * 1000

  printInfo(buildDir ? `Build directory: ${buildDir}` : "Project-level design")

  const registry = buildAgentRegistry(resolveFlavour(opts.flavour ?? null))
  const systemPrompt = registry.getCorePrompt("designer.md")

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  try {
    // Gather existing context
    const contextParts: string[] = []

    // Existing design.md at both levels
    const projectDesign = path.join(ridgelineDir, "design.md")
    if (fs.existsSync(projectDesign)) {
      contextParts.push("## Existing Project Design\n")
      contextParts.push(fs.readFileSync(projectDesign, "utf-8"))
      contextParts.push("")
    }

    if (buildDir) {
      const featureDesign = path.join(buildDir, "design.md")
      if (fs.existsSync(featureDesign)) {
        contextParts.push("## Existing Feature Design\n")
        contextParts.push(fs.readFileSync(featureDesign, "utf-8"))
        contextParts.push("")
      }

      // shape.md for context
      const shapePath = path.join(buildDir, "shape.md")
      if (fs.existsSync(shapePath)) {
        contextParts.push("## shape.md\n")
        contextParts.push(fs.readFileSync(shapePath, "utf-8"))
        contextParts.push("")
      }
    }

    if (opts.matchedShapes && opts.matchedShapes.length > 0) {
      contextParts.push("## Matched Shape Categories\n")
      contextParts.push(opts.matchedShapes.join(", "))
      contextParts.push("")
    }

    const userPrompt = [
      buildName
        ? `Gather design system context for build "${buildName}".`
        : "Gather project-level design system context.",
      "",
      ...(contextParts.length > 0 ? contextParts : ["No existing design context found."]),
      "",
      "Analyze the context above and ask design-focused questions.",
      "Remember: present ALL questions to the user even when pre-filled.",
    ].join("\n")

    // Intake turn
    process.stderr.write(`\n\x1b[90mAnalyzing design context...\x1b[0m\n`)
    let display = createDisplayCallbacks({ projectRoot: process.cwd() })
    const intakeResult = await invokeClaude({
      systemPrompt,
      userPrompt,
      model: opts.model,
      allowedTools: ["Read", "Glob", "Grep"],
      cwd: process.cwd(),
      timeoutMs,
      jsonSchema: QA_JSON_SCHEMA,
      onStdout: display.onStdout,
    })
    display.flush()

    // Clarification loop
    let sessionId = intakeResult.sessionId
    let qa = parseQAResponse(intakeResult.result)

    for (let round = 0; round < MAX_CLARIFICATION_ROUNDS && !qa.ready; round++) {
      if (qa.summary) {
        console.log(`\nDesign understanding so far:\n  ${qa.summary}`)
      }

      if (!qa.questions || qa.questions.length === 0) break

      const normalized = qa.questions.map(normalizeQuestion)
      console.log("\nDesign questions:\n")
      console.log(`  \x1b[90m(tip: you can enter a file path for longer answers)\x1b[0m\n`)
      const answers: string[] = []
      for (let i = 0; i < normalized.length; i++) {
        if (i > 0) console.log("")
        const q = normalized[i]
        if (q.suggestedAnswer) {
          console.log(`  ${i + 1}. ${q.question}`)
          console.log(`     \x1b[90m(suggested: ${q.suggestedAnswer})\x1b[0m`)
          const answer = await askQuestion(rl, `  > `)
          answers.push(answer || q.suggestedAnswer)
        } else {
          const answer = await askQuestion(rl, `  ${i + 1}. ${q.question}\n  > `)
          answers.push(answer)
        }
      }

      process.stderr.write(`\n\x1b[90mProcessing your answers...\x1b[0m\n`)
      const answersPrompt = normalized
        .map((q, i) => `Q: ${q.question}\nA: ${answers[i]}`)
        .join("\n\n")

      display = createDisplayCallbacks({ projectRoot: process.cwd() })
      const result = await invokeClaude({
        systemPrompt,
        userPrompt: `User answers to design questions:\n\n${answersPrompt}`,
        model: opts.model,
        allowedTools: ["Read", "Glob", "Grep"],
        cwd: process.cwd(),
        timeoutMs,
        sessionId,
        jsonSchema: QA_JSON_SCHEMA,
        onStdout: display.onStdout,
      })
      display.flush()

      sessionId = result.sessionId
      qa = parseQAResponse(result.result)
    }

    // Design output turn
    if (qa.summary) {
      console.log(`\nDesign summary:\n  ${qa.summary}`)
    }
    process.stderr.write(`\n\x1b[90mProducing design document...\x1b[0m\n`)

    display = createDisplayCallbacks({ projectRoot: process.cwd() })
    const designResult = await invokeClaude({
      systemPrompt,
      userPrompt: "Produce the final design document now. Respond with freeform markdown — NOT JSON. Structure it with headings, specific values (hard tokens), and directional guidance (soft guidance).",
      model: opts.model,
      cwd: process.cwd(),
      timeoutMs,
      sessionId,
      onStdout: display.onStdout,
    })
    display.flush()

    // Write design.md
    const designDir = path.dirname(outputPath)
    if (!fs.existsSync(designDir)) {
      fs.mkdirSync(designDir, { recursive: true })
    }
    fs.writeFileSync(outputPath, designResult.result)

    // Update pipeline state if in build context
    if (buildName && buildDir) {
      advancePipeline(buildDir, buildName, "design")
    }

    console.log("")
    printInfo("Created:")
    console.log(`  ${outputPath}`)
    console.log("")
    if (buildName) {
      printInfo(`Next: ridgeline spec ${buildName}`)
    }
  } finally {
    rl.close()
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/commands/__tests__/design.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/design.ts src/commands/__tests__/design.test.ts
git commit -m "$(cat <<'EOF'
feat: add ridgeline design command

Reuses the shaper's Q&A pattern with a design-focused agent prompt.
Supports standalone mode (project-level design.md) and build-context
mode (feature-level design.md with auto-chain from shape).
EOF
)"
```

---

## Task 8: CLI Registration & Create Flow

**Files:**

- Modify: `src/cli.ts`
- Modify: `src/commands/create.ts`
- Modify: `src/commands/index.ts`

Register the `ridgeline design` command in the CLI and add design stage awareness to the create flow.

- [ ] **Step 1: Register design command in CLI**

In `src/cli.ts`, add the import:

```typescript
import { runDesign } from "./commands/design"
```

Add the command after the `shape` command (around line 111):

```typescript
program
  .command("design [build-name]")
  .description("Establish or update visual design system (design.md)")
  .option("--model <name>", "Model for designer agent", "opus")
  .option("--timeout <minutes>", "Max duration per turn in minutes", "10")
  .option("--flavour <name-or-path>", "Agent flavour: built-in name or path to custom agents")
  .action(async (buildName: string | undefined, opts: Opts) => {
    try {
      await runDesign(buildName ? await requireBuildName(buildName) : null, {
        model: (opts.model as string) ?? "opus",
        timeout: parseInt(String(opts.timeout ?? "10"), 10),
        flavour: (opts.flavour as string) ?? undefined,
      })
    } catch (err) {
      handleCommandError(err)
    }
  })
```

- [ ] **Step 2: Update create.ts for design stage display and routing**

In `src/commands/create.ts`, add the import:

```typescript
import { runDesign, DesignOptions } from "./design"
```

Add `"design"` to the `STAGE_LABELS` map:

```typescript
const STAGE_LABELS: Record<PipelineStage, string> = {
  shape: "shape.md",
  design: "design.md",
  spec: "spec.md",
  research: "research.md",
  refine: "refine",
  plan: "phases/",
  build: "build",
}
```

Note: The `DISPLAY_STAGES` array already uses `PipelineStage` — update it to include design:

```typescript
const DISPLAY_STAGES: PipelineStage[] = ["shape", "design", "spec", "research", "refine", "plan", "build"]
```

Design is not in `REQUIRED_PIPELINE_STAGES`, so `getNextPipelineStage` won't auto-advance into it. Design auto-chains from shape (Task 9) or runs standalone. The create flow doesn't need a `case "design"` in the switch because design is never returned by `getNextPipelineStage`.

- [ ] **Step 3: Export from commands/index.ts**

In `src/commands/index.ts`, add:

```typescript
export { runDesign } from './design'
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/commands/create.ts src/commands/index.ts
git commit -m "$(cat <<'EOF'
feat: register ridgeline design command in CLI

Adds design as a standalone command and shows design.md status in the
create flow's pipeline display. Design auto-chains from shape when
visual concerns are detected (next task).
EOF
)"
```

---

## Task 9: Shape → Detection → Auto-Chain

**Files:**

- Modify: `src/commands/shape.ts`

After shape.md is written, run detection against shape definitions. If visual shapes match, record them in build state and auto-chain into `ridgeline design`.

- [ ] **Step 1: Add imports to shape.ts**

At the top of `src/commands/shape.ts`, add:

```typescript
import { loadShapeDefinitions, detectShapes } from "../shapes/detect"
import { recordMatchedShapes } from "../stores/state"
import { runDesign } from "./design"
```

- [ ] **Step 2: Add detection and auto-chain after shape output**

In `src/commands/shape.ts`, in the `runShape` function, after the `advancePipeline(buildDir, buildName, "shape")` call (around line 379) and before the final output, add the detection and auto-chain logic:

Replace the final output block (lines ~381-388):

```typescript
    // --- Shape detection ---
    const shapeMdContent = fs.readFileSync(path.join(buildDir, "shape.md"), "utf-8")
    const shapeDefinitions = loadShapeDefinitions()
    const matchedShapes = detectShapes(shapeMdContent, shapeDefinitions)

    if (matchedShapes.length > 0) {
      const matchedNames = matchedShapes.map((s) => s.name)
      recordMatchedShapes(buildDir, buildName, matchedNames)

      console.log("")
      printInfo("Created:")
      console.log(`  ${path.join(buildDir, "shape.md")}`)
      console.log("")
      printInfo(`Visual concerns detected: ${matchedNames.join(", ")}`)
      printInfo("Auto-chaining to design...")
      console.log("")

      // Auto-chain to design command within the same build context
      await runDesign(buildName, {
        model: opts.model,
        timeout: opts.timeout,
        flavour: opts.flavour,
        matchedShapes: matchedNames,
      })
    } else {
      console.log("")
      printInfo("Created:")
      console.log(`  ${path.join(buildDir, "shape.md")}`)
      console.log("")
      printInfo(`Next: ridgeline spec ${buildName}`)
    }
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/commands/shape.ts
git commit -m "$(cat <<'EOF'
feat: auto-detect visual shapes and chain to design command

After shape.md is produced, scans it against shape definitions. When
visual concerns are detected, records matched shapes in build state
and auto-chains into the design command for seamless UX.
EOF
)"
```

---

## Task 10: Visual Coherence Specialist

**Files:**

- Create: `src/agents/specifiers/visual-coherence.md`

Excluded from auto-discovery by the hardcoded exclusion list in `getSpecialists` (Task 4). Loaded conditionally in Task 11 via `getSpecialist`.

- [ ] **Step 1: Create the specialist prompt**

```markdown
---
name: visual-coherence
description: Evaluates specs through the lens of visual design concerns, informed by design.md
perspective: visual-coherence
---

You are the Visual Coherence Specialist. Your goal is to ensure the spec properly accounts for visual design requirements — both those explicitly stated in design.md and implicit ones that the other specialists may overlook.

Your unique inputs (in addition to shape.md):
- **design.md** (project and/or feature level) — contains hard tokens (non-negotiable values) and soft guidance (directional preferences)
- **Matched shape categories** — which visual domains apply (web-visual, game-visual, print-layout)

## What you check

**Hard token coverage:** Every hard token in design.md (specific hex codes, pixel values, font names, "must use" / "always" / "required" language) must map to at least one acceptance criterion on a relevant feature. If a feature touches UI and design.md specifies a spacing grid, that feature's criteria must reference the grid.

**Implicit visual requirements:** Features that involve user-facing output need visual acceptance criteria even if the shape didn't call them out:
- Responsive behavior at standard breakpoints (mobile/tablet/desktop)
- Loading states, empty states, error states — how they look, not just that they exist
- Interactive states: hover, focus, active, disabled
- Transition and animation behavior (or explicit "no animation")

**Soft guidance mapping:** Where design.md uses directional language ("prefer", "lean toward"), propose acceptance criteria as best-effort rather than blocking. Example: "Dashboard layout should generally follow the 8px spacing grid" rather than "Dashboard must use exactly 8px spacing."

**Design-specific constraints:** Propose check commands for visual verification where tooling exists. Example: "Run axe-core against the built output to verify WCAG AA compliance."

## What you produce

Same `SpecifierDraft` structure as other specialists, with emphasis on:
- Visual acceptance criteria distributed across features
- The `design` field populated with hard tokens, soft guidance, and per-feature visual criteria
- Constraints that reference design.md requirements
- Concerns about visual requirements the other specialists may miss

Populate the optional `design` field in your output:

```json

{
  "design": {
    "hardTokens": ["Primary color must be #2563EB", "Spacing grid: 8px base unit"],
    "softGuidance": ["Prefer muted backgrounds", "Lean toward rounded corners"],
    "featureVisuals": [
      {
        "feature": "Dashboard Layout",
        "criteria": ["Uses 8px spacing grid", "Responsive at 640/768/1024px breakpoints", "Color contrast meets WCAG AA"]
      }
    ]
  }
}

```text

If no design.md exists, infer reasonable visual defaults from the shape and flag the absence as a concern.
```

- [ ] **Step 2: Commit**

```bash
git add src/agents/specifiers/visual-coherence.md
git commit -m "$(cat <<'EOF'
feat: add visual coherence specialist for specifier ensemble

Conditional specialist that evaluates specs through the lens of visual
design. Maps hard tokens to acceptance criteria and surfaces implicit
visual requirements. Joins the ensemble only when visual shapes match.
EOF
)"
```

---

## Task 11: Conditional Visual Specialist in Specifier Ensemble

**Files:**

- Modify: `src/engine/pipeline/specify.exec.ts`
- Modify: `src/commands/spec.ts`

Pass matchedShapes to the specifier and conditionally add the visual specialist.

- [ ] **Step 1: Extend `SpecEnsembleConfig`**

In `src/engine/pipeline/specify.exec.ts`, add `matchedShapes` to the config type:

```typescript
export type SpecEnsembleConfig = {
  model: string
  timeoutMinutes: number
  maxBudgetUsd: number | null
  buildDir: string
  flavour: string | null
  matchedShapes: string[]
}
```

- [ ] **Step 2: Update `invokeSpecifier` to conditionally add visual specialist**

In `invokeSpecifier`, after getting the specialists from registry, conditionally add the visual coherence specialist:

```typescript
export const invokeSpecifier = async (
  shapeMd: string,
  config: SpecEnsembleConfig,
): Promise<EnsembleResult> => {
  const registry = buildAgentRegistry(resolveFlavour(config.flavour))

  // Get standard specialists
  let specialists = registry.getSpecialists("specifiers")

  // Conditionally add visual coherence specialist when visual shapes matched
  if (config.matchedShapes.length > 0) {
    const visualSpecialist = registry.getSpecialist("specifiers", "visual-coherence.md")
    if (visualSpecialist) {
      specialists = [...specialists, visualSpecialist]
    }
  }

  return invokeEnsemble<SpecifierDraft>({
    // ... rest stays the same
```

- [ ] **Step 3: Update specialist user prompt to include design context**

Update `assembleSpecialistUserPrompt` to accept and include design context:

```typescript
const assembleSpecialistUserPrompt = (
  shapeMd: string,
  config: SpecEnsembleConfig,
): string => {
  const sections: string[] = []

  sections.push(`## shape.md\n\n${shapeMd}`)
  sections.push("")

  // Inject design.md for visual specialist context
  const ridgelineDir = path.join(config.buildDir, "..", "..")
  const projectDesignPath = path.join(ridgelineDir, "design.md")
  const featureDesignPath = path.join(config.buildDir, "design.md")

  if (fs.existsSync(projectDesignPath)) {
    sections.push("## Project Design\n")
    sections.push(fs.readFileSync(projectDesignPath, "utf-8"))
    sections.push("")
  }

  if (fs.existsSync(featureDesignPath)) {
    sections.push("## Feature Design\n")
    sections.push(fs.readFileSync(featureDesignPath, "utf-8"))
    sections.push("")
  }

  if (config.matchedShapes.length > 0) {
    sections.push("## Matched Visual Shape Categories\n")
    sections.push(config.matchedShapes.join(", "))
    sections.push("")
  }

  sections.push("IMPORTANT: Respond with ONLY a JSON object. No prose, no markdown, no commentary. Just the JSON.")

  return sections.join("\n")
}
```

Update the call site in `invokeSpecifier` to use the new signature:

```typescript
specialistUserPrompt: assembleSpecialistUserPrompt(shapeMd, config),
```

- [ ] **Step 4: Update the JSON schema to include the design field**

In `SPEC_SPECIALIST_SCHEMA`, add the design property to the properties object:

```typescript
design: {
  type: ["object", "null"],
  properties: {
    hardTokens: { type: "array", items: { type: "string" } },
    softGuidance: { type: "array", items: { type: "string" } },
    featureVisuals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          feature: { type: "string" },
          criteria: { type: "array", items: { type: "string" } },
        },
        required: ["feature", "criteria"],
      },
    },
  },
},
```

No change to the `required` array — `design` is optional.

- [ ] **Step 5: Update spec command to pass matchedShapes**

In `src/commands/spec.ts`, add import:

```typescript
import { getMatchedShapes } from "../stores/state"
```

In `runSpec`, after reading shapeMd, get matchedShapes and pass to config:

```typescript
const config: SpecEnsembleConfig = {
  model: opts.model,
  timeoutMinutes: opts.timeout,
  maxBudgetUsd: opts.maxBudgetUsd ?? null,
  buildDir,
  flavour: opts.flavour ?? null,
  matchedShapes: getMatchedShapes(buildDir),
}
```

- [ ] **Step 6: Update synthesizer user prompt to include visual specialist design proposals**

In `assembleSynthesizerUserPrompt`, after the taste proposal section, add design proposal rendering:

```typescript
if (draft.design) {
  sections.push("**Design Proposal:**")
  if (draft.design.hardTokens && draft.design.hardTokens.length > 0) {
    sections.push(`- Hard tokens: ${draft.design.hardTokens.join("; ")}`)
  }
  if (draft.design.softGuidance && draft.design.softGuidance.length > 0) {
    sections.push(`- Soft guidance: ${draft.design.softGuidance.join("; ")}`)
  }
  if (draft.design.featureVisuals && draft.design.featureVisuals.length > 0) {
    sections.push("- Feature visuals:")
    for (const fv of draft.design.featureVisuals) {
      sections.push(`  - **${fv.feature}**: ${fv.criteria.join("; ")}`)
    }
  }
  sections.push("")
}
```

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/engine/pipeline/specify.exec.ts src/commands/spec.ts
git commit -m "$(cat <<'EOF'
feat: conditional visual specialist in specifier ensemble

When matchedShapes is non-empty, loads the visual coherence specialist
and adds it to the ensemble (4 specialists instead of 3). Passes
design.md context and matched shape categories to all specialists.
Extends SpecifierDraft schema with optional design field.
EOF
)"
```

---

## Task 12: Pipeline Consumer Injection (Planner, Builder, Reviewer)

**Files:**

- Modify: `src/engine/pipeline/plan.exec.ts`
- Modify: `src/engine/pipeline/build.exec.ts`
- Modify: `src/engine/pipeline/review.exec.ts`

Inject design.md into all downstream pipeline stages.

- [ ] **Step 1: Inject design.md in planner**

In `src/engine/pipeline/plan.exec.ts`, add import:

```typescript
import { appendConstraintsAndTaste, appendDesign } from "./pipeline.shared"
```

(Update the existing import to include `appendDesign`.)

In `assembleBaseUserPrompt`, after `appendConstraintsAndTaste(sections, config)`, add:

```typescript
appendDesign(sections, config)
```

- [ ] **Step 2: Inject design.md in builder**

In `src/engine/pipeline/build.exec.ts`, add `appendDesign` to the import from `pipeline.shared`:

```typescript
import { prepareAgentsAndPlugins, appendConstraintsAndTaste, appendDesign, commonInvokeOptions } from "./pipeline.shared"
```

In `assembleUserPrompt`, after `appendConstraintsAndTaste(sections, config)`, add:

```typescript
appendDesign(sections, config)
```

- [ ] **Step 3: Inject design.md and shape reviewer context in reviewer**

In `src/engine/pipeline/review.exec.ts`, add imports:

```typescript
import { appendDesign } from "./pipeline.shared"
import { getMatchedShapes } from "../../stores/state"
import { loadShapeDefinitions, detectShapes } from "../../shapes/detect"
```

In `assembleUserPrompt`, after the constraints section, add design.md and reviewer context:

```typescript
const assembleUserPrompt = (
  config: RidgelineConfig,
  phase: PhaseInfo,
  checkpointTag: string
): string => {
  const sections: string[] = []

  sections.push("## Phase Spec\n")
  sections.push(fs.readFileSync(phase.filepath, "utf-8"))
  sections.push("")

  const diff = getDiff(checkpointTag)
  sections.push("## Git Diff (checkpoint to HEAD)\n")
  if (diff) {
    sections.push("```diff")
    sections.push(diff)
    sections.push("```")
  } else {
    sections.push("No changes detected.")
  }
  sections.push("")

  sections.push("## constraints.md\n")
  sections.push(fs.readFileSync(config.constraintsPath, "utf-8"))
  sections.push("")

  // Inject design.md
  appendDesign(sections, config)

  // Inject reviewer context from matched shapes
  const matchedShapeNames = getMatchedShapes(config.buildDir)
  if (matchedShapeNames.length > 0) {
    const allDefs = loadShapeDefinitions()
    const matchedDefs = allDefs.filter((d) => matchedShapeNames.includes(d.name))

    if (matchedDefs.length > 0) {
      sections.push("## Visual Design Review Context\n")
      sections.push("The following visual design heuristics apply to this phase:\n")
      for (const def of matchedDefs) {
        sections.push(`### ${def.name}\n`)
        sections.push(def.reviewerContext)
        sections.push("")
      }
      sections.push("**Review rules for design.md:**")
      sections.push("- Hard token violations (specific values with imperative language) → severity: blocking")
      sections.push("- Soft guidance deviations (directional language) → severity: suggestion")
      sections.push("- Skipped tools → noted in verdict, never blocking")
      sections.push("")
    }
  }

  return sections.join("\n")
}
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 5: Run existing tests**

Run: `npx vitest run src/engine/pipeline/__tests__/`
Expected: All existing tests pass (new injection is additive — appendDesign is a no-op when design.md doesn't exist)

- [ ] **Step 6: Commit**

```bash
git add src/engine/pipeline/plan.exec.ts src/engine/pipeline/build.exec.ts src/engine/pipeline/review.exec.ts
git commit -m "$(cat <<'EOF'
feat: inject design.md into planner, builder, and reviewer

Planner and builder receive design.md as context alongside constraints
and taste. Reviewer additionally gets shape-specific design heuristics
and hard/soft token review rules.
EOF
)"
```

---

## Task 13: Web-Visual Plugin

**Files:**

- Create: `plugin/web-visual/plugin.json`
- Create: `plugin/web-visual/tools/screenshot.md`
- Create: `plugin/web-visual/tools/css-audit.md`
- Create: `plugin/web-visual/tools/a11y-audit.md`
- Create: `plugin/web-visual/tools/visual-diff.md`
- Create: `plugin/web-visual/tools/lighthouse.md`

These are tool agent prompts for the reviewer. Each checks if its CLI tool is available and gracefully skips if not.

- [ ] **Step 1: Create plugin directory and manifest**

```json
// plugin/web-visual/plugin.json
{
  "name": "ridgeline-web-visual",
  "description": "Visual design verification tools for web projects — screenshots, CSS audit, accessibility, visual diff, and Lighthouse"
}
```

- [ ] **Step 2: Create screenshot tool**

```markdown
<!-- plugin/web-visual/tools/screenshot.md -->
---
name: screenshot
description: Capture screenshots at multiple viewports using Playwright for visual review
---

You are a screenshot capture tool. You use Playwright to render web pages and capture screenshots at standard viewport sizes.

## Prerequisites Check

First, verify Playwright is available:

```bash

npx playwright --version 2>/dev/null

```text

If the command fails or returns an error, report:
```

skipped: playwright not installed (install with: npm i -D playwright)

```text
And stop. Do not attempt to capture screenshots.

## Capture Process

When Playwright is available:

1. Determine the URL or file path to capture. If a dev server is running, use its URL. If capturing static HTML, use a file:// URL.

2. Capture at three standard viewports:
   - Mobile: 375x812
   - Tablet: 768x1024
   - Desktop: 1440x900

3. For each viewport, run:

```bash

npx playwright screenshot --viewport-size="<width>,<height>" "<url>" "screenshot-<viewport>.png"

```text

4. Report the captured screenshot paths so the reviewer can evaluate them visually.

## Output Format

Report results as structured text:

```

Screenshots captured:

- Mobile (375x812): screenshot-mobile.png
- Tablet (768x1024): screenshot-tablet.png
- Desktop (1440x900): screenshot-desktop.png

```text

Or if skipped:

```

skipped: playwright not installed

```text
```

- [ ] **Step 3: Create CSS audit tool**

```markdown
<!-- plugin/web-visual/tools/css-audit.md -->
---
name: css-audit
description: Analyze CSS statistics using Project Wallace to detect design system drift
---

You are a CSS audit tool. You use Project Wallace's CSS analyzer to produce machine-readable statistics about CSS in the project.

## Prerequisites Check

First, verify the analyzer is available:

```bash

npx @projectwallace/css-analyzer --version 2>/dev/null

```text

If unavailable, report:
```

skipped: @projectwallace/css-analyzer not installed (install with: npm i -D @projectwallace/css-analyzer)

```text
And stop.

## Audit Process

When available:

1. Find CSS files in the project build output (dist/, build/, .next/, out/, or source CSS files).

2. Analyze each CSS file:

```bash

npx @projectwallace/css-analyzer <path-to-css>

```text

3. Look for design system drift indicators:
   - **Unique colors count** — high count suggests inconsistent palette usage
   - **Unique font sizes** — should align with type scale in design.md
   - **Unique spacing values** — should align with spacing grid in design.md
   - **Near-duplicate values** — e.g., #333 and #334, or 15px and 16px

## Output Format

Report findings as structured text:

```

CSS Audit Results:

- Unique colors: 23 (design.md specifies 8-color palette)
- Unique font sizes: 12 (design.md type scale has 8 steps)
- Near-duplicate colors: #333333 vs #343434
- Near-duplicate spacing: 15px vs 16px (design.md grid: 8px)

```text

Map findings to severity:
- Values that clearly violate hard tokens → flag as concerning
- Values that are near-misses of the design system → flag as drift
```

- [ ] **Step 4: Create accessibility audit tool**

```markdown
<!-- plugin/web-visual/tools/a11y-audit.md -->
---
name: a11y-audit
description: Run accessibility checks using axe-core to verify WCAG compliance
---

You are an accessibility audit tool. You use axe-core to check web content for WCAG violations.

## Prerequisites Check

First, verify axe-core CLI is available:

```bash

npx @axe-core/cli --version 2>/dev/null

```text

If unavailable, report:
```

skipped: @axe-core/cli not installed (install with: npm i -D @axe-core/cli)

```text
And stop.

## Audit Process

When available:

1. Determine the URL to audit. If a dev server is running, use its URL. For static files, a local server may be needed.

2. Run the accessibility audit:

```bash

npx axe <url> --exit

```text

3. Parse the results for:
   - **Critical violations** — must be fixed (e.g., missing alt text, insufficient color contrast)
   - **Serious violations** — should be fixed
   - **Moderate/minor violations** — worth noting

## Output Format

Report findings:

```

Accessibility Audit:

- Critical: 2 violations
  - color-contrast: Insufficient contrast ratio (3.2:1, required 4.5:1) at .header-text
  - image-alt: Missing alt text on 3 images
- Serious: 1 violation
  - aria-roles: Invalid ARIA role on .nav-menu
- Moderate: 0
- Passes: 45 checks passed

```text

Map to review severity:
- Critical/serious WCAG violations → blocking if design.md requires WCAG AA/AAA
- Moderate/minor → suggestion
- Color contrast failures are always blocking when design.md specifies contrast requirements
```

- [ ] **Step 5: Create visual diff tool**

```markdown
<!-- plugin/web-visual/tools/visual-diff.md -->
---
name: visual-diff
description: Compare screenshots against reference images using pixelmatch
---

You are a visual diff tool. You use pixelmatch to compare rendered screenshots against reference images.

## Prerequisites Check

First, verify pixelmatch is available:

```bash

node -e "require('pixelmatch')" 2>/dev/null && echo "available" || echo "unavailable"

```text

If unavailable, report:
```

skipped: pixelmatch not installed (install with: npm i -D pixelmatch)

```text
And stop.

## Diff Process

When available:

1. Look for reference images in the build's specs or a designated reference directory (e.g., `.ridgeline/references/`, `tests/visual/references/`).

2. If no reference images exist, report:
```

skipped: no reference images found (create references with ridgeline screenshot first)

```text

3. When references exist, compare each screenshot to its reference:

```javascript

// Use Node.js script to compare
const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

const img1 = PNG.sync.read(fs.readFileSync('reference.png'));
const img2 = PNG.sync.read(fs.readFileSync('screenshot.png'));
const diff = new PNG({width: img1.width, height: img1.height});
const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, {threshold: 0.1});
const mismatchPercent = (numDiffPixels / (img1.width * img1.height) * 100).toFixed(2);

```text

## Output Format

```

Visual Diff Results:

- Mobile: 0.3% mismatch (within threshold)
- Tablet: 2.1% mismatch (EXCEEDS threshold)
- Desktop: 0.1% mismatch (within threshold)
- Diff images saved to: diff-mobile.png, diff-tablet.png, diff-desktop.png

```text

Map to severity:
- Mismatch > 5%: blocking (significant visual regression)
- Mismatch 1-5%: suggestion (minor visual change, review recommended)
- Mismatch < 1%: pass
```

- [ ] **Step 6: Create Lighthouse tool**

```markdown
<!-- plugin/web-visual/tools/lighthouse.md -->
---
name: lighthouse
description: Run Lighthouse audits for accessibility, performance, and best practices
---

You are a Lighthouse audit tool. You use Google Lighthouse to audit web pages for accessibility, performance, and best practices.

## Prerequisites Check

First, verify Lighthouse is available:

```bash

npx lighthouse --version 2>/dev/null

```text

If unavailable, report:
```

skipped: lighthouse not installed (install with: npm i -D lighthouse)

```text
And stop.

## Audit Process

When available:

1. Determine the URL to audit.

2. Run Lighthouse in headless mode:

```bash

npx lighthouse <url> --output=json --output-path=lighthouse-report.json --chrome-flags="--headless --no-sandbox" --only-categories=accessibility,performance,best-practices

```text

3. Parse the JSON report for key scores and audits.

## Output Format

```

Lighthouse Audit:

- Accessibility: 92/100
  - Failed: color-contrast (score: 0)
  - Failed: heading-order (score: 0)
- Performance: 85/100
  - Largest Contentful Paint: 2.4s
  - Cumulative Layout Shift: 0.05
- Best Practices: 95/100
  - Failed: uses-passive-event-listeners

```text

Map to severity:
- Accessibility score < 90 → blocking if design.md requires WCAG compliance
- Individual accessibility audit failures → reference against design.md requirements
- Performance and best practices → suggestion (informational)
```

- [ ] **Step 7: Verify plugin structure**

Run: `find plugin/web-visual -type f | sort`
Expected output:

```text
plugin/web-visual/plugin.json
plugin/web-visual/tools/a11y-audit.md
plugin/web-visual/tools/css-audit.md
plugin/web-visual/tools/lighthouse.md
plugin/web-visual/tools/screenshot.md
plugin/web-visual/tools/visual-diff.md
```

- [ ] **Step 8: Commit**

```bash
git add plugin/web-visual/
git commit -m "$(cat <<'EOF'
feat: add web-visual tool family plugin

Five tool agents for visual verification: Playwright screenshots,
Project Wallace CSS audit, axe-core accessibility, pixelmatch visual
diff, and Lighthouse audits. All tools gracefully skip when their
CLI dependencies aren't installed.
EOF
)"
```

---

## Task 14: Specifier Synthesizer Prompt Update

**Files:**

- Modify: `src/agents/core/specifier.md`

Update the synthesizer instructions to handle visual specialist proposals.

- [ ] **Step 1: Read current specifier.md**

Run: Read `src/agents/core/specifier.md` to understand the current synthesizer prompt.

- [ ] **Step 2: Add visual specialist merging instructions**

Append the following section to `src/agents/core/specifier.md`, before the closing rules/output section:

```markdown
## Visual Specialist Integration

When a visual coherence specialist proposal is present (identified by the `visual-coherence` perspective), handle it as follows:

**Merging visual acceptance criteria:** The visual specialist proposes acceptance criteria specific to visual features. Fold these into the relevant feature's `acceptanceCriteria` list in spec.md — do not create a separate "visual" section. Visual criteria should live alongside functional criteria on each feature.

**Design field in proposals:** If the visual specialist populates the `design` field:
- `hardTokens` are non-negotiable design constraints. Reflect them in constraints.md under a `## Design Tokens` section.
- `softGuidance` are best-effort preferences. Reflect them in taste.md under a `## Visual Style` section.
- `featureVisuals` map visual criteria to specific features — use this to distribute criteria across the spec.

**When no visual specialist is present:** Ignore this section entirely. The standard 3-specialist synthesis applies.

**Conflict resolution:** If the visual specialist's criteria conflict with another specialist's (e.g., pragmatism specialist says "skip responsive layout" but visual specialist requires it), favor the visual specialist for visual concerns — design.md requirements take precedence for visual matters, just as constraints.md takes precedence for technical matters.
```

- [ ] **Step 3: Commit**

```bash
git add src/agents/core/specifier.md
git commit -m "$(cat <<'EOF'
feat: update specifier synthesizer for visual specialist merging

Adds instructions for folding visual acceptance criteria into features,
mapping hard tokens to constraints.md and soft guidance to taste.md,
and resolving conflicts between visual and other specialists.
EOF
)"
```

---

## Task 15: Rewind Support for Design Stage

**Files:**

- Modify: `src/commands/rewind.ts`

The rewind command needs to handle the new "design" stage.

- [ ] **Step 1: Read rewind.ts**

Run: Read `src/commands/rewind.ts` to understand the current validation.

- [ ] **Step 2: Update stage validation if needed**

The rewind command uses `PipelineStage` for validation. Since we've already added `"design"` to the `PipelineStage` type and to `ALL_PIPELINE_STAGES` in state.ts, and `collectStageFiles` already has a `"design"` case, the rewind command should work without changes — verify by reading the file and confirming the stage validation uses the type system.

If the rewind command hardcodes valid stage names (e.g., in a help message or validation check), update those to include `"design"`.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 4: Commit (if changes were needed)**

```bash
git add src/commands/rewind.ts
git commit -m "$(cat <<'EOF'
feat: support design stage in rewind command
EOF
)"
```

---

## Task 16: Lint & Verify

- [ ] **Step 1: Run full typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: No type errors

- [ ] **Step 2: Run all unit tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No lint errors

- [ ] **Step 4: Fix any issues found in steps 1-3**

Address any type errors, test failures, or lint violations. Common issues:

- Missing imports for `path` in pipeline.shared.ts
- Mock updates needed in existing tests for new `getSpecialist` method
- Lint warnings on new files

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: fix lint and type issues from visual design system feature
EOF
)"
```

---

## Summary of Build Order

```text
Task 1  → Shape definition JSON files (data)
Task 2  → Shape detection module (logic + tests)
Task 3  → Build state extensions (types + state)
Task 4  → Agent registry extension (_ prefix + getSpecialist)
Task 5  → Design.md injection (pipeline.shared + tests)
Task 6  → Designer agent prompt (data)
Task 7  → Design command (logic + tests)
Task 8  → CLI registration & create flow
Task 9  → Shape → detection → auto-chain
Task 10 → Visual coherence specialist prompt (data)
Task 11 → Conditional visual specialist in ensemble
Task 12 → Pipeline consumer injection (planner, builder, reviewer)
Task 13 → Web-visual plugin (data, tool prompts)
Task 14 → Specifier synthesizer prompt update
Task 15 → Rewind support for design stage
Task 16 → Lint & verify
```

Each task produces a working, committable state. Tasks 1-5 build the infrastructure. Tasks 6-9 deliver the design command. Tasks 10-14 wire visual awareness into the pipeline. Tasks 15-16 ensure everything is clean.
