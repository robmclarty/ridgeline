# Visual Tool Skills & Flavour Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bespoke tool family pipeline with Claude skills 2.0 adapters in a unified plugin, create `web-ui` and `web-game` flavours with `recommendedSkills`, enhance `software-engineering` with visual awareness, and simplify the pipeline.

**Architecture:** Tool skills (SKILL.md format) live in `plugin/visual-tools/skills/` and are discovered by Claude via `--plugin-dir`. Flavours provide domain-specific builder/reviewer agents that assertively reference tools. A `recommendedSkills` field in flavour config links flavours to skills for setup-time availability checks. The pipeline drops tool family injection — Claude's skill system handles tool activation.

**Tech Stack:** TypeScript, Vitest, Claude skills 2.0 spec, CLI tools (agent-browser, pixelmatch, naga, axe-core, Project Wallace, Lighthouse)

---

### Task 1: Create the visual-tools plugin directory and plugin.json

**Files:**
- Create: `plugin/visual-tools/plugin.json`

- [ ] **Step 1: Create plugin directory structure**

```bash
mkdir -p plugin/visual-tools/skills
```

- [ ] **Step 2: Write plugin.json**

Create `plugin/visual-tools/plugin.json`:

```json
{
  "name": "ridgeline-visual-tools",
  "description": "Visual verification tool skills for web and game development — browser screenshots, visual diffing, CSS auditing, accessibility checks, shader validation"
}
```

- [ ] **Step 3: Commit**

```bash
git add plugin/visual-tools/plugin.json
git commit -m "feat: create visual-tools plugin directory"
```

---

### Task 2: Create the agent-browser skill

**Files:**
- Create: `plugin/visual-tools/skills/agent-browser/SKILL.md`
- Create: `plugin/visual-tools/skills/agent-browser/references/viewports.md`

- [ ] **Step 1: Write the SKILL.md**

Create `plugin/visual-tools/skills/agent-browser/SKILL.md`:

```markdown
---
name: agent-browser
description: Capture annotated browser screenshots with numbered element labels for visual verification. Use when building or reviewing web UIs, verifying responsive layouts, checking visual output of canvas/WebGL content, or inspecting rendered pages. Trigger when asked to screenshot, verify layout, check rendering, or visually inspect a running web app.
compatibility: Requires agent-browser CLI (npm i -g @anthropic-ai/agent-browser)
metadata:
  author: ridgeline
  version: "1.0"
---

# Agent Browser

Agent-first browser automation CLI. Produces annotated screenshots with numbered element labels and compact DOM snapshots optimized for AI context.

## Opening a page

```bash
agent-browser open <url>
```

Opens the URL in a headless browser session. The session persists until explicitly closed.

## Taking screenshots

```bash
agent-browser screenshot --annotate
```

Captures the current viewport with numbered labels on interactive elements. Each label maps to an element you can reference in subsequent commands.

For a specific viewport width:

```bash
agent-browser screenshot --annotate --viewport 375x812
```

## Reading page structure

```bash
agent-browser snapshot -i
```

Returns a compact text representation of the page's interactive elements and structure. Uses ~93% less context than raw HTML.

## Responsive verification workflow

Capture at standard viewports to verify responsive behavior. See `references/viewports.md` for the standard viewport list.

1. Open the page
2. Screenshot at each viewport size
3. Compare layouts — check for overflow, truncation, misalignment, stacking issues

## Closing the session

```bash
agent-browser close
```
```

- [ ] **Step 2: Write the viewports reference**

Create `plugin/visual-tools/skills/agent-browser/references/viewports.md`:

```markdown
# Standard Viewports

Use these viewport sizes for responsive verification:

| Name    | Width | Height | Use case                    |
|---------|-------|--------|-----------------------------|
| Mobile  | 375   | 812    | iPhone SE / small phones    |
| Tablet  | 768   | 1024   | iPad / medium tablets       |
| Desktop | 1440  | 900    | Standard laptop/desktop     |

## Usage

```bash
agent-browser screenshot --annotate --viewport 375x812
agent-browser screenshot --annotate --viewport 768x1024
agent-browser screenshot --annotate --viewport 1440x900
```
```

- [ ] **Step 3: Commit**

```bash
git add plugin/visual-tools/skills/agent-browser/
git commit -m "feat: add agent-browser skill for visual verification"
```

---

### Task 3: Create the visual-diff skill

**Files:**
- Create: `plugin/visual-tools/skills/visual-diff/SKILL.md`

- [ ] **Step 1: Write the SKILL.md**

Create `plugin/visual-tools/skills/visual-diff/SKILL.md`:

```markdown
---
name: visual-diff
description: Compare screenshots pixel-by-pixel against reference images to detect visual regressions. Use when checking for unintended visual changes, comparing before/after screenshots, or validating that UI changes match expectations.
compatibility: Requires pixelmatch (npm i -g pixelmatch) and pngjs (npm i -g pngjs)
metadata:
  author: ridgeline
  version: "1.0"
---

# Visual Diff

Pixel-level screenshot comparison using pixelmatch. Compares two PNG images and produces a diff image highlighting changed pixels.

## Comparing two screenshots

Write and run a Node.js script:

```javascript
const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

const img1 = PNG.sync.read(fs.readFileSync('reference.png'));
const img2 = PNG.sync.read(fs.readFileSync('current.png'));
const { width, height } = img1;
const diff = new PNG({ width, height });

const mismatchedPixels = pixelmatch(
  img1.data, img2.data, diff.data, width, height,
  { threshold: 0.1 }
);

fs.writeFileSync('diff.png', PNG.sync.write(diff));

const totalPixels = width * height;
const mismatchPercent = ((mismatchedPixels / totalPixels) * 100).toFixed(2);
console.log(`Mismatched pixels: ${mismatchedPixels} (${mismatchPercent}%)`);
```

## Interpreting results

- **< 1% mismatch**: Pass — sub-pixel rendering differences, antialiasing
- **1–5% mismatch**: Review — may be intentional changes or minor regressions
- **> 5% mismatch**: Likely regression — investigate the diff image

## Creating reference images

Save a known-good screenshot as the reference. Store references alongside the test:

```
tests/visual/
  reference/
    homepage-mobile.png
    homepage-desktop.png
  current/
    homepage-mobile.png
    homepage-desktop.png
  diff/
    homepage-mobile.png
```

## Gotchas

- Images must be the same dimensions. Resize first if viewports differ.
- Font rendering varies across OS — set threshold to 0.1 or higher to account for antialiasing.
- Dynamic content (timestamps, avatars) causes false positives. Mock or hide dynamic elements before capture.
```

- [ ] **Step 2: Commit**

```bash
git add plugin/visual-tools/skills/visual-diff/
git commit -m "feat: add visual-diff skill for screenshot comparison"
```

---

### Task 4: Create the css-audit skill

**Files:**
- Create: `plugin/visual-tools/skills/css-audit/SKILL.md`

- [ ] **Step 1: Write the SKILL.md**

Create `plugin/visual-tools/skills/css-audit/SKILL.md`:

```markdown
---
name: css-audit
description: Analyze CSS for design system drift, specificity issues, and bloat using Project Wallace. Use when reviewing CSS quality, checking for unused rules, auditing color and font consistency, or detecting specificity problems in stylesheets.
compatibility: Requires Project Wallace CSS Analyzer (npm i -g @projectwallace/css-analyzer)
metadata:
  author: ridgeline
  version: "1.0"
---

# CSS Audit

Analyze CSS statistics to detect design system drift, specificity issues, and bloat.

## Running an audit

```bash
npx @projectwallace/css-analyzer ./path/to/styles.css
```

For multiple files, concatenate first:

```bash
cat src/**/*.css | npx @projectwallace/css-analyzer --stdin
```

## What to check

### Color consistency
Look at unique color count. A design system should have 8–15 unique colors. More than 20 signals drift — values like `#333` vs `#343434` vs `rgb(51,51,51)` that should be a single token.

### Font size consistency
Check unique font-size count. More than 8–10 unique sizes suggests missing a type scale. Look for near-duplicates like `14px` and `0.875rem` (same value, different units).

### Specificity issues
High max specificity (above `0,3,0`) risks cascade conflicts. Check the specificity distribution — heavy clustering above `0,2,0` means selectors are fighting each other.

### Selector complexity
Average selector length above 3 suggests over-qualified selectors. Look for selectors like `.header .nav .list .item a` that should be simplified.

## Severity mapping

- **> 25 unique colors**: Suggestion — likely design system drift
- **Max specificity > 0,4,0**: Suggestion — cascade risk
- **> 15 unique font sizes**: Suggestion — missing type scale
- **Average selector length > 4**: Suggestion — over-qualified selectors
```

- [ ] **Step 2: Commit**

```bash
git add plugin/visual-tools/skills/css-audit/
git commit -m "feat: add css-audit skill for CSS quality analysis"
```

---

### Task 5: Create the a11y-audit skill

**Files:**
- Create: `plugin/visual-tools/skills/a11y-audit/SKILL.md`

- [ ] **Step 1: Write the SKILL.md**

Create `plugin/visual-tools/skills/a11y-audit/SKILL.md`:

```markdown
---
name: a11y-audit
description: Run WCAG 2.1 AA accessibility checks using axe-core. Use when verifying accessibility compliance, checking contrast ratios, validating ARIA usage, auditing keyboard navigation, or reviewing landmark structure.
compatibility: Requires axe-core CLI (npm i -g @axe-core/cli)
metadata:
  author: ridgeline
  version: "1.0"
---

# Accessibility Audit

Run automated WCAG 2.1 AA compliance checks against a running web page.

## Running an audit

```bash
npx @axe-core/cli <url>
```

Example:

```bash
npx @axe-core/cli http://localhost:3000 --stdout
```

## Common checks

axe-core tests for:
- **Color contrast**: Text must meet WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text)
- **ARIA attributes**: Valid roles, required properties, correct state management
- **Keyboard navigation**: All interactive elements focusable, logical tab order
- **Landmark regions**: Content in appropriate landmarks (main, nav, footer)
- **Image alt text**: All images have appropriate alt attributes
- **Form labels**: All inputs have associated labels
- **Heading hierarchy**: Headings in logical order without skipping levels

## Interpreting results

axe categorizes violations by impact:
- **Critical**: Blocks access for some users entirely (e.g., missing form labels, keyboard traps)
- **Serious**: Significantly impairs usability (e.g., contrast failures, missing landmarks)
- **Moderate**: Creates difficulty but doesn't block access
- **Minor**: Best practice improvements

## Severity mapping

- Critical or serious violations → blocking
- Moderate or minor violations → suggestion

## Gotchas

- axe-core only catches ~30% of accessibility issues. Manual testing (keyboard navigation, screen reader) is still needed.
- Dynamic content (modals, dropdowns) must be in their open state to be tested.
- Single-page apps: test multiple routes, not just the landing page.
```

- [ ] **Step 2: Commit**

```bash
git add plugin/visual-tools/skills/a11y-audit/
git commit -m "feat: add a11y-audit skill for accessibility checks"
```

---

### Task 6: Create the lighthouse skill

**Files:**
- Create: `plugin/visual-tools/skills/lighthouse/SKILL.md`

- [ ] **Step 1: Write the SKILL.md**

Create `plugin/visual-tools/skills/lighthouse/SKILL.md`:

```markdown
---
name: lighthouse
description: Run Lighthouse audits for performance, accessibility, and best practices scoring. Use when checking page performance, running quality audits, measuring Core Web Vitals, or getting a quantitative quality score for a web page.
compatibility: Requires Lighthouse CLI (npm i -g lighthouse)
metadata:
  author: ridgeline
  version: "1.0"
---

# Lighthouse Audit

Run Google Lighthouse for quantitative quality scores across performance, accessibility, and best practices.

## Running an audit

```bash
npx lighthouse <url> --output json --output-path ./lighthouse-report.json --only-categories=performance,accessibility,best-practices --chrome-flags="--headless=new --no-sandbox"
```

For a quick text summary:

```bash
npx lighthouse <url> --output html --output-path ./lighthouse-report.html --only-categories=performance,accessibility,best-practices --chrome-flags="--headless=new --no-sandbox"
```

## Reading results

Parse the JSON output to extract category scores:

```bash
node -e "
const r = require('./lighthouse-report.json');
const cats = r.categories;
console.log('Performance:', Math.round(cats.performance.score * 100));
console.log('Accessibility:', Math.round(cats.accessibility.score * 100));
console.log('Best Practices:', Math.round(cats['best-practices'].score * 100));
"
```

## Score thresholds

- **Performance > 90**: Good
- **Performance 50–90**: Needs improvement
- **Performance < 50**: Poor
- **Accessibility > 90**: Good (aim for 100)
- **Accessibility < 90**: Needs attention

## Severity mapping

- Accessibility score < 90 when design.md requires WCAG → blocking
- Performance or best practices concerns → suggestion
- All scores are informational by default — context determines severity

## Gotchas

- Lighthouse scores vary between runs (±5 points). Run 3 times and take the median for reliable results.
- Local dev servers often score low on performance due to unminified assets. This is expected.
- Lighthouse requires a running page — start the dev server first.
```

- [ ] **Step 2: Commit**

```bash
git add plugin/visual-tools/skills/lighthouse/
git commit -m "feat: add lighthouse skill for quality audits"
```

---

### Task 7: Create the canvas-screenshot skill

**Files:**
- Create: `plugin/visual-tools/skills/canvas-screenshot/SKILL.md`

- [ ] **Step 1: Write the SKILL.md**

Create `plugin/visual-tools/skills/canvas-screenshot/SKILL.md`:

```markdown
---
name: canvas-screenshot
description: Capture rendered canvas and WebGL frames from browser-based games and visual applications. Use when verifying canvas rendering, checking WebGL output, capturing game screenshots, or validating visual output from PixiJS, Phaser, Three.js, or raw canvas apps.
compatibility: Requires agent-browser CLI (npm i -g @anthropic-ai/agent-browser) or Playwright (npm i -g playwright)
metadata:
  author: ridgeline
  version: "1.0"
---

# Canvas Screenshot

Capture stable frames from canvas-based and WebGL applications. Unlike regular page screenshots, canvas content requires waiting for the render loop to produce a stable frame.

## With agent-browser (preferred)

```bash
agent-browser open <url>
```

Wait for the canvas to render by checking for stability:

```bash
agent-browser screenshot --annotate
```

If the canvas is still loading (black or empty), wait and retry:

```bash
sleep 2
agent-browser screenshot --annotate
```

## With Playwright (fallback)

Write and run a script when agent-browser is unavailable:

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('<url>');

  // Wait for canvas to be present and rendered
  await page.waitForSelector('canvas');

  // Wait for render loop to stabilize — give it a few frames
  await page.waitForTimeout(2000);

  // Screenshot just the canvas element
  const canvas = await page.$('canvas');
  await canvas.screenshot({ path: 'canvas-capture.png' });

  await browser.close();
})();
```

## Handling render loop timing

Canvas apps use `requestAnimationFrame` for rendering. A screenshot taken too early may capture a blank or partially-rendered frame.

**Strategy:**
1. Wait for the canvas element to exist in the DOM
2. Wait 1–3 seconds for initial asset loading and first meaningful render
3. Capture the frame
4. If the result looks blank or incomplete, wait longer and recapture

## Multiple scenes / states

For games with multiple screens (menu, gameplay, pause):
1. Capture the initial state (usually a menu or loading screen)
2. Interact to reach the target state (click play, trigger a game event)
3. Wait for the transition to complete
4. Capture the target state

## Gotchas

- WebGL contexts may not render in headless mode without GPU flags. Use `--use-gl=angle --use-angle=swiftshader` if rendering is blank.
- Canvas `toDataURL()` may be tainted by cross-origin images. Ensure assets are served from the same origin or with proper CORS headers.
- High-DPI displays produce larger screenshots. Set `deviceScaleFactor: 1` for consistent results.
```

- [ ] **Step 2: Commit**

```bash
git add plugin/visual-tools/skills/canvas-screenshot/
git commit -m "feat: add canvas-screenshot skill for game/WebGL capture"
```

---

### Task 8: Create the shader-validate skill

**Files:**
- Create: `plugin/visual-tools/skills/shader-validate/SKILL.md`

- [ ] **Step 1: Write the SKILL.md**

Create `plugin/visual-tools/skills/shader-validate/SKILL.md`:

```markdown
---
name: shader-validate
description: Validate and cross-compile GLSL, WGSL, and SPIR-V shaders using naga. Use when writing shaders, checking shader compilation, debugging shader errors, converting between shader languages, or verifying WebGL/WebGPU shader code.
compatibility: Requires naga-cli (cargo install naga-cli)
metadata:
  author: ridgeline
  version: "1.0"
---

# Shader Validation

Validate and cross-compile shaders using naga — a fast Rust-based shader translator supporting WGSL, GLSL, SPIR-V, MSL, and HLSL.

## Validating a shader

```bash
naga my_shader.wgsl
naga my_shader.frag
naga my_shader.vert
```

Exit code 0 means the shader is valid. Non-zero prints error details with line numbers.

## Cross-compiling shaders

Convert between shader languages by specifying input and output files:

```bash
# WGSL to SPIR-V
naga shader.wgsl shader.spv

# GLSL to WGSL
naga shader.frag shader.wgsl

# SPIR-V to Metal
naga shader.spv shader.metal

# WGSL to GLSL (with profile)
naga shader.wgsl shader.frag --profile es310
```

The output format is determined by file extension.

## Common GLSL validation

For WebGL fragment shaders:

```bash
naga my_effect.frag
```

For vertex shaders:

```bash
naga my_mesh.vert
```

## Batch validation

Validate all shaders in a directory:

```bash
find src/shaders -name '*.frag' -o -name '*.vert' -o -name '*.wgsl' | xargs -I {} naga {}
```

## Common errors

- **"unknown type"**: Missing uniform/varying declaration or typo in type name
- **"expected ';'"**: Missing semicolon (GLSL) or syntax mismatch
- **"binding collision"**: Two resources share the same binding index
- **"entry point not found"**: Missing `main` function (GLSL) or `@vertex`/`@fragment` annotation (WGSL)

## Gotchas

- naga's GLSL support requires the shader stage to be inferred from the file extension (`.vert`, `.frag`, `.comp`). Use the correct extension.
- WGSL is the native format — validation is most thorough for WGSL input.
- naga does not execute shaders. It checks syntax, types, and resource bindings — not runtime behavior.
```

- [ ] **Step 2: Commit**

```bash
git add plugin/visual-tools/skills/shader-validate/
git commit -m "feat: add shader-validate skill for GLSL/WGSL validation"
```

---

### Task 9: Ship the plugin directory in the npm package

The `plugin/` directory at the project root is not currently included in the npm build. The build script copies `src/agents` and `src/flavours` to `dist/` but not `plugin/`. Fix this so the visual-tools plugin ships with ridgeline.

**Files:**
- Modify: `package.json:10` (build script)

- [ ] **Step 1: Write the failing test**

Create or verify that after build, `dist/plugin/visual-tools/plugin.json` would exist. Since this is a build script change, verify manually:

```bash
npm run build
ls dist/plugin/visual-tools/plugin.json
```

Expected: file not found (currently not copied).

- [ ] **Step 2: Update the build script**

In `package.json`, update the `build` script to also copy `plugin/`:

Change line 10 from:
```json
"build": "tsc && rm -rf dist/agents && cp -r src/agents dist/agents && rm -rf dist/flavours && cp -r src/flavours dist/flavours",
```

To:
```json
"build": "tsc && rm -rf dist/agents && cp -r src/agents dist/agents && rm -rf dist/flavours && cp -r src/flavours dist/flavours && rm -rf dist/plugin && cp -r plugin dist/plugin",
```

- [ ] **Step 3: Verify the build**

```bash
npm run build
ls dist/plugin/visual-tools/plugin.json
ls dist/plugin/visual-tools/skills/agent-browser/SKILL.md
```

Expected: both files exist.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: include plugin directory in dist output"
```

---

### Task 10: Add bundled plugin discovery to the pipeline

`discoverPluginDirs` currently only checks the user's `.ridgeline/plugin/` and `.ridgeline/builds/<name>/plugin/`. It needs to also discover ridgeline's own bundled `plugin/` directory (which ships inside the npm package at `dist/plugin/`).

**Files:**
- Modify: `src/engine/discovery/plugin.scan.ts:38-54`
- Test: `src/engine/discovery/__tests__/plugin.scan.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test to `src/engine/discovery/__tests__/plugin.scan.test.ts`:

```typescript
it("discovers the bundled plugin directory", () => {
  const dir = getBundledPluginDir()
  // In test/dev environment, this resolves to the project root plugin/ dir
  // In production, it resolves to dist/plugin/
  // The function should return a path or null
  if (dir) {
    expect(fs.existsSync(dir)).toBe(true)
  }
})
```

Run: `npx vitest run src/engine/discovery/__tests__/plugin.scan.test.ts`
Expected: FAIL — `getBundledPluginDir` is not exported.

- [ ] **Step 2: Add getBundledPluginDir function**

In `src/engine/discovery/plugin.scan.ts`, add a function to resolve the bundled plugin directory:

```typescript
/**
 * Resolve ridgeline's own bundled plugin directory.
 * Checks dist/plugin/ and src-root plugin/ layouts.
 */
export const getBundledPluginDir = (): string | null => {
  const candidates = [
    path.join(__dirname, "..", "..", "plugin"),           // dist/plugin
    path.join(__dirname, "..", "..", "..", "plugin"),      // src layout
    path.join(__dirname, "..", "..", "..", "..", "plugin"), // dev fallback
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      const entries = fs.readdirSync(dir)
      if (entries.length > 0) return dir
    }
  }
  return null
}
```

- [ ] **Step 3: Update discoverPluginDirs to include bundled plugins**

In `discoverPluginDirs`, after discovering user-level plugin dirs, also discover subdirectories of the bundled plugin dir. Each subdirectory (e.g., `plugin/visual-tools/`) is a separate plugin:

```typescript
export const discoverPluginDirs = (config: RidgelineConfig): PluginDir[] => {
  const dirs: PluginDir[] = []

  const candidates = [
    { base: config.buildDir, name: `ridgeline-build-${config.buildName}` },
    { base: config.ridgelineDir, name: "ridgeline-project" },
  ]

  for (const { base, name } of candidates) {
    if (!isPluginDir(base)) continue
    const pluginDir = path.join(base, "plugin")
    const createdPluginJson = ensurePluginJson(pluginDir, name)
    dirs.push({ dir: pluginDir, createdPluginJson })
  }

  // Discover bundled plugins (shipped with ridgeline)
  const bundledRoot = getBundledPluginDir()
  if (bundledRoot) {
    for (const entry of fs.readdirSync(bundledRoot)) {
      const subdir = path.join(bundledRoot, entry)
      if (!fs.statSync(subdir).isDirectory()) continue
      if (!fs.existsSync(path.join(subdir, "plugin.json"))) continue
      dirs.push({ dir: subdir, createdPluginJson: false })
    }
  }

  return dirs
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/engine/discovery/__tests__/plugin.scan.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/discovery/plugin.scan.ts src/engine/discovery/__tests__/plugin.scan.test.ts
git commit -m "feat: discover bundled plugin directories shipped with ridgeline"
```

---

### Task 11: Add recommendedSkills to flavour config

Flavours currently have no config file — they're just directories of markdown agents. Add an optional `flavour.json` config with a `recommendedSkills` field. Create a loader function and tests.

**Files:**
- Create: `src/engine/discovery/flavour.config.ts`
- Create: `src/engine/discovery/__tests__/flavour.config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/engine/discovery/__tests__/flavour.config.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  }
})

import { loadFlavourConfig, FlavourConfig } from "../flavour.config"

beforeEach(() => vi.clearAllMocks())

describe("loadFlavourConfig", () => {
  it("returns empty config when no flavour.json exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const config = loadFlavourConfig("/flavours/web-ui")
    expect(config.recommendedSkills).toEqual([])
  })

  it("loads recommendedSkills from flavour.json", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      recommendedSkills: ["agent-browser", "visual-diff", "css-audit"]
    }))

    const config = loadFlavourConfig("/flavours/web-ui")

    expect(config.recommendedSkills).toEqual(["agent-browser", "visual-diff", "css-audit"])
    expect(fs.readFileSync).toHaveBeenCalledWith(
      path.join("/flavours/web-ui", "flavour.json"),
      "utf-8"
    )
  })

  it("returns empty config when flavour.json is malformed", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue("not valid json {{{")

    const config = loadFlavourConfig("/flavours/web-ui")
    expect(config.recommendedSkills).toEqual([])
  })

  it("returns empty config when flavourDir is null", () => {
    const config = loadFlavourConfig(null)
    expect(config.recommendedSkills).toEqual([])
  })

  it("handles flavour.json without recommendedSkills field", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      name: "web-ui"
    }))

    const config = loadFlavourConfig("/flavours/web-ui")
    expect(config.recommendedSkills).toEqual([])
  })
})
```

Run: `npx vitest run src/engine/discovery/__tests__/flavour.config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement flavour.config.ts**

Create `src/engine/discovery/flavour.config.ts`:

```typescript
import * as fs from "node:fs"
import * as path from "node:path"

export type FlavourConfig = {
  recommendedSkills: string[]
}

const EMPTY_CONFIG: FlavourConfig = { recommendedSkills: [] }

/**
 * Load optional flavour.json config from a flavour directory.
 * Returns empty config if no file exists or it's malformed.
 */
export const loadFlavourConfig = (flavourDir: string | null): FlavourConfig => {
  if (!flavourDir) return EMPTY_CONFIG

  const configPath = path.join(flavourDir, "flavour.json")
  if (!fs.existsSync(configPath)) return EMPTY_CONFIG

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    return {
      recommendedSkills: Array.isArray(raw.recommendedSkills) ? raw.recommendedSkills : [],
    }
  } catch {
    return EMPTY_CONFIG
  }
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/engine/discovery/__tests__/flavour.config.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/engine/discovery/flavour.config.ts src/engine/discovery/__tests__/flavour.config.test.ts
git commit -m "feat: add flavour.json config loader with recommendedSkills"
```

---

### Task 12: Create the web-ui flavour

**Files:**
- Create: `src/flavours/web-ui/flavour.json`
- Create: `src/flavours/web-ui/core/builder.md`
- Create: `src/flavours/web-ui/core/reviewer.md`

- [ ] **Step 1: Create flavour.json**

Create `src/flavours/web-ui/flavour.json`:

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

- [ ] **Step 2: Create builder.md**

Create `src/flavours/web-ui/core/builder.md`. This should follow the exact format of the existing `software-engineering/core/builder.md` — same frontmatter structure, same section headings, same output markers — but with web UI domain knowledge and assertive tool usage.

The builder agent should include all sections from the software-engineering builder (orient, implement, check, verify acceptance criteria, commit, write handoff, handle retries) with these additions:

- In the **Orient** section: assess the design.md for color tokens, typography scale, spacing system, and responsive breakpoints before writing code.
- In the **Implement** section: build mobile-first, use semantic HTML, follow the spacing and color tokens from design.md as hard constraints.
- In the **Check** section: capture screenshots at 375px, 768px, and 1440px viewports. Run a CSS audit to check for design system drift. Run accessibility checks against WCAG 2.1 AA.
- In the **Verify Acceptance Criteria** section: verify each visual criterion by screenshot — do not mark visual criteria as met without capturing evidence.

The full builder.md content should be modeled on the software-engineering builder but with these web-UI-specific additions woven in. Read `src/flavours/software-engineering/core/builder.md` as the template and adapt it.

- [ ] **Step 3: Create reviewer.md**

Create `src/flavours/web-ui/core/reviewer.md`. Follow the exact format of `software-engineering/core/reviewer.md` with these additions:

- In the **Review diff** section: check for responsive patterns — media queries, fluid typography, container queries. Verify the CSS architecture follows the design tokens.
- In the **Verification checks** section: capture screenshots at mobile/tablet/desktop viewports. Run visual diff against reference images if they exist. Run accessibility audit. Run CSS audit.
- In the **Walk acceptance criteria** section: for any visual criterion, verify by screenshot — do not mark visual criteria as met based on code reading alone.
- Add a **Visual quality checklist** section checking: color contrast ratios, typography hierarchy, spacing consistency, interactive states (hover, focus, active, disabled), loading/empty/error states, responsive behavior across breakpoints.

The full reviewer.md content should be modeled on the software-engineering reviewer but with these web-UI-specific additions woven in. Read `src/flavours/software-engineering/core/reviewer.md` as the template and adapt it.

- [ ] **Step 4: Commit**

```bash
git add src/flavours/web-ui/
git commit -m "feat: add web-ui flavour with builder and reviewer agents"
```

---

### Task 13: Create the web-game flavour

**Files:**
- Create: `src/flavours/web-game/flavour.json`
- Create: `src/flavours/web-game/core/builder.md`
- Create: `src/flavours/web-game/core/reviewer.md`

- [ ] **Step 1: Create flavour.json**

Create `src/flavours/web-game/flavour.json`:

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

- [ ] **Step 2: Create builder.md**

Create `src/flavours/web-game/core/builder.md`. Follow the format of the `game-dev/core/builder.md` (which already has game-specific structure) but adapted for browser-based games:

- In the **Orient** section: identify the rendering approach (canvas 2D, WebGL, PixiJS, Phaser, Three.js, raw DOM). Assess the design.md for art direction, color palette, asset dimensions, HUD style.
- In the **Implement** section: set up the game loop with `requestAnimationFrame`. Structure code around scenes/states (menu, gameplay, pause, game over). Implement rendering pipeline first, then game logic, then UI/HUD.
- In the **Check** section: capture a canvas screenshot after scene initialization to verify rendering. Validate all shaders compile cleanly. Verify the game runs without console errors. Check that the game loop maintains target framerate.
- In the **Verify Acceptance Criteria** section: for visual criteria, capture canvas screenshots as evidence. For gameplay criteria, verify by running the game and testing interactions.

Adapt from `game-dev/core/builder.md` with browser-specific tooling references.

- [ ] **Step 3: Create reviewer.md**

Create `src/flavours/web-game/core/reviewer.md`. Follow the format of `game-dev/core/reviewer.md` with browser-specific additions:

- In the **Verification checks** section: capture canvas screenshot to verify rendering output. Run visual diff against reference frames if they exist. Validate shader compilation. Check for WebGL context errors.
- In the **Craft quality** section (suggestions): game feel (input latency, animation smoothness), visual feedback (clear action responses), state coherence (clean scene transitions), asset quality (correct dimensions, no stretching, palette consistency).
- In the **Performance** section: check for requestAnimationFrame usage (not setInterval), monitor draw calls, check for canvas resize handling, verify asset preloading.

Adapt from `game-dev/core/reviewer.md` with browser-specific tooling references.

- [ ] **Step 4: Commit**

```bash
git add src/flavours/web-game/
git commit -m "feat: add web-game flavour with builder and reviewer agents"
```

---

### Task 14: Enhance software-engineering flavour with visual awareness

**Files:**
- Create: `src/flavours/software-engineering/flavour.json`
- Modify: `src/flavours/software-engineering/core/builder.md`
- Modify: `src/flavours/software-engineering/core/reviewer.md`

- [ ] **Step 1: Create flavour.json**

Create `src/flavours/software-engineering/flavour.json`:

```json
{
  "name": "software-engineering",
  "recommendedSkills": [
    "agent-browser",
    "visual-diff"
  ]
}
```

- [ ] **Step 2: Update builder.md**

Read `src/flavours/software-engineering/core/builder.md`. Add a section in the implementation workflow (after the existing check step) that says:

> If this phase produces user-facing UI, capture screenshots to verify the visual output matches expectations. Run a visual diff against reference images if they exist.

This should be a small addition — 2-3 sentences woven into the existing flow, not a separate section. The builder's primary focus remains code quality; visual verification is an additional check when relevant.

- [ ] **Step 3: Update reviewer.md**

Read `src/flavours/software-engineering/core/reviewer.md`. Add to the verification checklist:

> If the phase includes user-facing changes, capture screenshots to verify the visual output. Check for obvious layout issues, broken styling, or visual regressions.

Again, a small addition — the reviewer's primary focus remains code correctness and acceptance criteria. Visual checks are part of the review when the output has a UI.

- [ ] **Step 4: Commit**

```bash
git add src/flavours/software-engineering/
git commit -m "feat: add visual awareness to software-engineering flavour"
```

---

### Task 15: Remove toolFamily from shape definitions

**Files:**
- Modify: `src/shapes/web-visual.json`
- Modify: `src/shapes/game-visual.json`
- Modify: `src/shapes/print-layout.json`
- Modify: `src/shapes/detect.ts:4-8`
- Modify: `src/shapes/__tests__/detect.test.ts`

- [ ] **Step 1: Update the ShapeDefinition type**

In `src/shapes/detect.ts`, change the type to remove `toolFamily`:

```typescript
export type ShapeDefinition = {
  name: string
  keywords: string[]
  reviewerContext: string
}
```

- [ ] **Step 2: Update shape JSON files**

Remove the `toolFamily` field from each shape file.

`src/shapes/web-visual.json`:
```json
{
  "name": "web-visual",
  "keywords": ["UI", "frontend", "CSS", "responsive", "web app", "dashboard", "website", "landing page", "SPA", "component library", "design system", "Tailwind", "React", "Vue", "Svelte"],
  "reviewerContext": "Check responsive behavior at mobile/tablet/desktop viewports. Verify interactive states. Evaluate whitespace and visual breathing room. Check color contrast ratios."
}
```

`src/shapes/game-visual.json`:
```json
{
  "name": "game-visual",
  "keywords": ["game", "sprite", "texture", "3D", "scene", "canvas", "WebGL", "Godot", "Unity", "Phaser"],
  "reviewerContext": "Verify asset dimensions match specification. Check color palette consistency. Validate sprite sheet layouts. Evaluate UI overlay legibility against game backgrounds."
}
```

`src/shapes/print-layout.json`:
```json
{
  "name": "print-layout",
  "keywords": ["print", "PDF", "document", "brochure", "typography", "poster", "flyer", "report"],
  "reviewerContext": "Verify bleed and trim areas. Check font embedding. Validate resolution meets print DPI requirements. Evaluate typographic hierarchy and spacing consistency."
}
```

- [ ] **Step 3: Update detect.test.ts**

In `src/shapes/__tests__/detect.test.ts`, remove `toolFamily` from all test fixtures:

Change:
```typescript
const webVisual = {
  name: "web-visual",
  keywords: ["UI", "frontend", "web app", "dashboard"],
  toolFamily: "web-visual",
  reviewerContext: "Check responsive behavior.",
}

const gameVisual = {
  name: "game-visual",
  keywords: ["game", "sprite", "WebGL"],
  toolFamily: "game-visual",
  reviewerContext: "Verify asset dimensions.",
}

const printLayout = {
  name: "print-layout",
  keywords: ["print", "PDF", "brochure"],
  toolFamily: "print-layout",
  reviewerContext: "Verify bleed and trim.",
}
```

To:
```typescript
const webVisual = {
  name: "web-visual",
  keywords: ["UI", "frontend", "web app", "dashboard"],
  reviewerContext: "Check responsive behavior.",
}

const gameVisual = {
  name: "game-visual",
  keywords: ["game", "sprite", "WebGL"],
  reviewerContext: "Verify asset dimensions.",
}

const printLayout = {
  name: "print-layout",
  keywords: ["print", "PDF", "brochure"],
  reviewerContext: "Verify bleed and trim.",
}
```

Also update the `"skips files missing required fields"` test — remove the `toolFamily` from fixture objects that test for missing fields:

Change:
```typescript
const missingKeywords = { name: "incomplete", toolFamily: "x", reviewerContext: "y" }
const missingName = { keywords: ["a"], toolFamily: "x", reviewerContext: "y" }
```

To:
```typescript
const missingKeywords = { name: "incomplete", reviewerContext: "y" }
const missingName = { keywords: ["a"], reviewerContext: "y" }
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/shapes/__tests__/detect.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shapes/ src/shapes/__tests__/detect.test.ts
git commit -m "refactor: remove toolFamily from shape definitions"
```

---

### Task 16: Simplify reviewer context injection

The reviewer currently injects tool-usage instructions via shape `reviewerContext`. With skills handling tool usage, the reviewer context should focus on domain heuristics only. The "skipped tools" rule also goes away — there are no tool-family tools to skip anymore.

**Files:**
- Modify: `src/engine/pipeline/review.exec.ts:43-61`
- Modify: `src/engine/pipeline/__tests__/review.exec.test.ts`

- [ ] **Step 1: Read the existing review.exec test**

Read `src/engine/pipeline/__tests__/review.exec.test.ts` to understand the current test structure.

- [ ] **Step 2: Simplify the reviewer context injection**

In `src/engine/pipeline/review.exec.ts`, simplify the shape context injection block. Remove the "skipped tools" rule since skills handle tools now:

Change lines 43-61 from:
```typescript
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
```

To:
```typescript
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
      sections.push("")
    }
  }
```

The only change is removing the "Skipped tools" line.

- [ ] **Step 3: Update tests if needed**

Check `src/engine/pipeline/__tests__/review.exec.test.ts` for any assertions about "Skipped tools" text. Update them to remove that expectation.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/engine/pipeline/__tests__/review.exec.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/pipeline/review.exec.ts src/engine/pipeline/__tests__/review.exec.test.ts
git commit -m "refactor: remove skipped-tools rule from reviewer context injection"
```

---

### Task 17: Add recommended tools check to the create command

**Files:**
- Create: `src/engine/discovery/skill.check.ts`
- Create: `src/engine/discovery/__tests__/skill.check.test.ts`
- Modify: `src/commands/create.ts`

- [ ] **Step 1: Write the failing test for skill checking**

Create `src/engine/discovery/__tests__/skill.check.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "node:fs"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
  }
})

import { parseSkillCompatibility } from "../skill.check"

beforeEach(() => vi.clearAllMocks())

describe("parseSkillCompatibility", () => {
  it("extracts compatibility string from SKILL.md frontmatter", () => {
    const content = [
      "---",
      "name: agent-browser",
      "description: Browser automation",
      "compatibility: Requires agent-browser CLI (npm i -g @anthropic-ai/agent-browser)",
      "---",
      "",
      "# Agent Browser",
    ].join("\n")

    const result = parseSkillCompatibility(content)

    expect(result).toBe("Requires agent-browser CLI (npm i -g @anthropic-ai/agent-browser)")
  })

  it("returns null when no compatibility field", () => {
    const content = [
      "---",
      "name: something",
      "description: A skill",
      "---",
      "",
      "# Content",
    ].join("\n")

    const result = parseSkillCompatibility(content)
    expect(result).toBeNull()
  })
})
```

Run: `npx vitest run src/engine/discovery/__tests__/skill.check.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement skill.check.ts**

Create `src/engine/discovery/skill.check.ts`:

```typescript
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { getBundledPluginDir } from "./plugin.scan"

export type SkillAvailability = {
  name: string
  isAvailable: boolean
  compatibility: string | null
}

/**
 * Extract the compatibility string from SKILL.md frontmatter.
 */
export const parseSkillCompatibility = (content: string): string | null => {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null

  const fmMatch = match[1].match(/^compatibility:\s*(.+)$/m)
  return fmMatch ? fmMatch[1].trim() : null
}

/**
 * Extract the install command from a compatibility string.
 * Looks for patterns like (npm i -g ...) or (cargo install ...).
 */
const extractInstallCommand = (compatibility: string): string | null => {
  const match = compatibility.match(/\(([^)]*(?:npm|cargo|pip|brew)[^)]*)\)/)
  return match ? match[1] : null
}

/**
 * Extract the tool name from a compatibility string.
 * Looks for "Requires <tool-name>" pattern.
 */
const extractToolName = (compatibility: string): string | null => {
  const match = compatibility.match(/Requires\s+(\S+)/)
  return match ? match[1] : null
}

/**
 * Check if a tool is available on PATH.
 */
const isToolAvailable = (toolName: string): boolean => {
  try {
    execSync(`command -v ${toolName}`, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/**
 * Check availability of recommended skills for a flavour.
 * Reads SKILL.md files from the bundled plugin directory,
 * extracts compatibility info, and checks tool availability.
 */
export const checkRecommendedSkills = (skillNames: string[]): SkillAvailability[] => {
  if (skillNames.length === 0) return []

  const bundledRoot = getBundledPluginDir()
  if (!bundledRoot) return skillNames.map(name => ({ name, isAvailable: false, compatibility: null }))

  return skillNames.map(name => {
    // Search all plugin subdirectories for the skill
    try {
      const pluginDirs = fs.readdirSync(bundledRoot).filter(entry =>
        fs.statSync(path.join(bundledRoot, entry)).isDirectory()
      )

      for (const pluginDir of pluginDirs) {
        const skillPath = path.join(bundledRoot, pluginDir, "skills", name, "SKILL.md")
        if (!fs.existsSync(skillPath)) continue

        const content = fs.readFileSync(skillPath, "utf-8")
        const compatibility = parseSkillCompatibility(content)

        if (!compatibility) return { name, isAvailable: true, compatibility: null }

        const toolName = extractToolName(compatibility)
        const isAvailable = toolName ? isToolAvailable(toolName) : false

        return { name, isAvailable, compatibility }
      }
    } catch {
      // Skip unreadable directories
    }

    return { name, isAvailable: false, compatibility: null }
  })
}

/**
 * Format skill availability results for display.
 */
export const formatSkillAvailability = (results: SkillAvailability[]): string => {
  if (results.length === 0) return ""

  const lines: string[] = []
  lines.push("  Recommended tools for this flavour:")

  for (const { name, isAvailable } of results) {
    const icon = isAvailable ? "✓" : "✗"
    const status = isAvailable ? "(found)" : "(not found)"
    lines.push(`    ${icon} ${name.padEnd(20)} ${status}`)
  }

  const missing = results.filter(r => !r.isAvailable && r.compatibility)
  if (missing.length > 0) {
    lines.push("")
    lines.push("  Install missing tools:")
    for (const { compatibility } of missing) {
      const installCmd = extractInstallCommand(compatibility!)
      if (installCmd) lines.push(`    ${installCmd}`)
    }
    lines.push("")
    lines.push("  These are optional — ridgeline works")
    lines.push("  without them, but results improve with")
    lines.push("  them installed.")
  }

  return lines.join("\n")
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/engine/discovery/__tests__/skill.check.test.ts
```

Expected: PASS.

- [ ] **Step 4: Wire into create command**

In `src/commands/create.ts`, after the status table display and before starting the next stage, add the recommended skills check:

Add imports at the top:
```typescript
import { resolveFlavour } from "../engine/discovery/flavour.resolve"
import { loadFlavourConfig } from "../engine/discovery/flavour.config"
import { checkRecommendedSkills, formatSkillAvailability } from "../engine/discovery/skill.check"
```

After the status table (after `console.log("")` on line 57), add:

```typescript
  // Show recommended tools for the flavour
  const flavourDir = resolveFlavour(opts.flavour ?? null)
  const flavourConfig = loadFlavourConfig(flavourDir)
  if (flavourConfig.recommendedSkills.length > 0) {
    const availability = checkRecommendedSkills(flavourConfig.recommendedSkills)
    const display = formatSkillAvailability(availability)
    if (display) {
      console.log(display)
      console.log("")
    }
  }
```

- [ ] **Step 5: Run full test suite for create command**

```bash
npx vitest run src/commands/__tests__/create.test.ts src/engine/discovery/__tests__/skill.check.test.ts
```

Expected: PASS (create tests may need mock updates if they assert on console output).

- [ ] **Step 6: Commit**

```bash
git add src/engine/discovery/skill.check.ts src/engine/discovery/__tests__/skill.check.test.ts src/commands/create.ts
git commit -m "feat: show recommended tool availability at project creation"
```

---

### Task 18: Remove the old web-visual plugin

**Files:**
- Delete: `plugin/web-visual/` (entire directory)

- [ ] **Step 1: Verify no code references plugin/web-visual/ by path**

```bash
grep -r "web-visual" src/ --include="*.ts" -l
```

The only references should be in `src/shapes/web-visual.json` (the shape definition, which we've already removed `toolFamily` from) and possibly tests. The `plugin/web-visual/` directory itself should not be referenced by any TypeScript code — it was discovered via the generic plugin scan, not by name.

- [ ] **Step 2: Delete the directory**

```bash
rm -rf plugin/web-visual/
```

- [ ] **Step 3: Commit**

```bash
git add -A plugin/web-visual/
git commit -m "chore: remove old web-visual plugin (replaced by visual-tools skills)"
```

---

### Task 19: Copy shapes to dist and update build script

The `src/shapes/*.json` files are not currently copied to `dist/` by the build script. The `resolveShapesDir()` function handles this with fallback paths, but for consistency with how agents and flavours are handled, add an explicit copy.

**Files:**
- Modify: `package.json:10` (build script)

- [ ] **Step 1: Update build script**

In `package.json`, update the `build` script to also copy `src/shapes/`:

Change from the current build script (which was updated in Task 9) to:
```json
"build": "tsc && rm -rf dist/agents && cp -r src/agents dist/agents && rm -rf dist/flavours && cp -r src/flavours dist/flavours && rm -rf dist/plugin && cp -r plugin dist/plugin && rm -rf dist/shapes && cp -r src/shapes dist/shapes",
```

Note: the `dist/shapes` directory will contain both `.json` files and the compiled `.js`/`.d.ts` files from the TypeScript compiler. The JSON files need to be the source copies (which include the `.json` extension that the compiled detect.js looks for).

Actually, since `src/shapes/detect.ts` compiles to `dist/shapes/detect.js`, and `resolveShapesDir` already checks `__dirname` first (which would be `dist/shapes/`), the JSON files just need to be in the same directory. The `cp -r src/shapes dist/shapes` would overwrite the compiled output. Instead, just copy the JSON files:

```json
"build": "tsc && rm -rf dist/agents && cp -r src/agents dist/agents && rm -rf dist/flavours && cp -r src/flavours dist/flavours && rm -rf dist/plugin && cp -r plugin dist/plugin && cp src/shapes/*.json dist/shapes/",
```

- [ ] **Step 2: Verify**

```bash
npm run build
ls dist/shapes/*.json
```

Expected: `web-visual.json`, `game-visual.json`, `print-layout.json` all present in `dist/shapes/`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build: copy shape definitions and plugin directory to dist"
```

---

### Task 20: Run full test suite and lint

**Files:** (none — verification only)

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: no errors. Fix any issues that arise from the changes.

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 4: Fix any issues and commit**

If any tests, lint, or type errors were found, fix them and commit:

```bash
git add -A
git commit -m "fix: resolve test and lint issues from visual-tools migration"
```

---

### Task 21: Update documentation

**Files:**
- Modify: `docs/flavours.md`

- [ ] **Step 1: Add web-ui and web-game to flavours documentation**

Read `docs/flavours.md` and add entries for the two new flavours in the appropriate section. Include:
- `web-ui` — Web application UI development with visual verification tools
- `web-game` — Browser-based interactive and visual projects (canvas, WebGL, game frameworks)

Also document the `flavour.json` config file and `recommendedSkills` field. Add a brief section explaining how flavours recommend but don't require tools.

- [ ] **Step 2: Commit**

```bash
git add docs/flavours.md
git commit -m "docs: add web-ui, web-game flavours and recommendedSkills documentation"
```
