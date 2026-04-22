# Constraints

## Language and Runtime

- TypeScript 5.9 in strict mode; no implicit `any`; all new public functions have explicit return types.
- Existing `tsconfig.json` is preserved.
- Runtime: Node.js 20+. `package.json` gains `"engines": { "node": ">=20.0.0" }` in 0.8.0 — the field is currently absent. The floor is set by Playwright's active-support baseline (1.57 deprecates Node 18) and matches the existing `@types/node@22` dev-time baseline.
- Claude CLI subprocess substrate preserved; authentication via the user's Claude subscription OAuth (not API key).

## Framework

- CLI via `commander@13` (preserved).
- Dashboard server uses Node's built-in `http` module. No web framework, no bundler step, no client-side runtime framework (no React, Vue, Svelte).
- Dashboard client is vanilla HTML + inline CSS + vanilla JS served from the local ridgeline process; targets evergreen Chromium / WebKit / Firefox.

## Directory Layout

Preserve existing `src/{cli,commands,engine,stores,ui,flavours,agents,catalog,utils}` layout. New modules slot in without relocating existing ones:

- `src/engine/detect/` — project-signal scanner (`index.ts` exports `detect(cwd)` and the `DetectionReport` interface).
- `src/sensors/` — one file per sensor (`playwright.ts`, `vision.ts`, `a11y.ts`, `contrast.ts`) plus `index.ts`; each exports a typed adapter.
- `src/ui/preflight.ts` — preflight summary renderer and blocking prompt.
- `src/ui/color.ts` (or equivalent single module) — semantic-color helper shared by terminal UI modules and preflight.
- `src/ui/dashboard/` — dashboard HTML template, inline CSS, client JS, SSE adapter (all inline assets).
- `src/commands/ui.ts` — `ridgeline ui` CLI subcommand.

Removed flavour directories must be deleted from disk, not renamed to `legacy/` or retained as dormant config.

Tests live beside source code in `src/**/__tests__/` or under the top-level `test/` directory per existing convention.

## Naming

- Boolean identifiers use `is` / `has` / `should` prefixes: `isVisualSurface`, `hasDesignMd`, `shouldRunPreflight`, `isMerged`, `isReducedMotion`.
- Types and interfaces in PascalCase: `DetectionReport`, `SensorFinding`, `SpecialistVerdict`.
- Functions and variables in camelCase.
- File names follow existing dot-suffix convention where applicable: `agent.prompt.ts`, `ensemble.exec.ts`, `flavour.resolve.ts`. New files may use flat kebab-case where no equivalent dot-suffix exists.
- CLI flags are kebab-case: `--thorough`, `--yes`, `--port`.
- CSS custom properties use kebab-case tokens matching the design token names below: `--bg`, `--panel`, `--border`, `--text`, `--text-dim`, `--error`, `--success`, `--warning`, `--info`.

## API Style

- Internal module boundaries use plain async functions returning plain data objects; no class hierarchies beyond what already exists.
- Sensor adapters export a uniform shape: `{ name: string, run(input): Promise<SensorFinding[]> }`.
- Dashboard HTTP surface exposes exactly three local endpoints: `GET /` (HTML), `GET /state` (JSON snapshot for polling fallback), `GET /events` (SSE stream). Bound to `127.0.0.1` only; never `0.0.0.0`.
- No REST, JSON-RPC, authentication, or external HTTP API.
- No telemetry, analytics, or cloud state. `settings.json` remains the sole project-local configuration surface.

## Dependencies

Preserved:

- `commander@13`
- `sharp@0.34`, `colorthief@3.3`, `free-tex-packer-core@0.3` (catalog-only, untouched)
- `typescript@5.9`, `vitest@4.1`, `oxlint@1.58`, `markdownlint-cli2@0.21`, `agnix@0.17`, `fallow@2.13` (dev tooling)
- Greywall (macOS sandbox), bubblewrap / bwrap (Linux sandbox)
- Git (checkpoints, worktrees)

New:

- `playwright` — **peerDependency** (not installed by default; preflight prompts a one-command install when a visual surface is detected and the module is not resolvable).
- `axe-core` — direct dependency, programmatic accessibility audit.
- `wcag-contrast` — direct dependency, contrast ratio utility (used by both the contrast sensor and the dashboard's build-time contrast verification).

No other new runtime dependencies. No icon fonts, no icon libraries (`lucide-react`, `heroicons`, etc.), no webfont packages, no CSS frameworks (Tailwind, Bootstrap), no UI kits. SVG icon shapes are copied inline from Lucide references.

## Sandboxing and Security

- Greywall (macOS) and bwrap (Linux) sandbox adapters preserved unchanged.
- Visual sensors run inside the existing sandbox; if sandbox restrictions block the browser process, the sensor degrades to a warning and the phase continues (not abort).
- Playwright browser process must be constrained to localhost and the detected dev-server port. No general network access granted to the browser.
- `axe-core` and the contrast checker run locally against the project's own rendered output; no external reporting.
- Claude vision sends screenshot content through the existing Claude CLI path (same trust boundary as other agent calls).

## Design Tokens

Hard, non-negotiable design constraints enforced across the dashboard and (where semantically meaningful) the terminal UI.

### Palette

Defined once as CSS custom properties on `:root` and referenced everywhere — never repeat hex values inline.

- `--bg: #0B0F14` (page background)
- `--panel: #121821` (panel fill)
- `--border: #1F2937` (panel border)
- `--text: #E5E7EB` (primary text)
- `--text-dim: #9CA3AF` (secondary / metadata text)
- `--error: #EF4444`
- `--success: #10B981`
- `--warning: #F59E0B`
- `--info: #06B6D4`

Accent fills are the accent color at **exactly 10% opacity**. Text rendered on an accent fill must be contrast-verified ≥4.5:1 via `wcag-contrast` and brightened if short.

No gradients. No pure-black (`#000`) backgrounds anywhere. No drop shadows. No decorative use of semantic accents — they appear only for their named meanings.

### Typography

- Sans stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- Mono stack: `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`
- Font-size scale is exactly: **12, 13, 14, 16, 20 px** — no intermediate sizes appear in rendered output.
- Mono stack used for phase IDs, dollar amounts, elapsed times, and raw file values; sans for everything else.
- Build name: 20 px sans, full text color.
- Status pill text: 11 px uppercase sans with tracked letter-spacing.
- Body copy: 14 px sans.
- Labels and hints: 12–13 px sans in text-dim.
- No webfonts. No `@font-face` declarations. Zero font requests at page load.

### Spacing and Density

- Base unit **4 px**; allowed steps: 4 / 8 / 12 / 16 / 24 / 32 / 48.
- No arbitrary values (e.g. 5 px, 10 px, 15 px) appear in rendered CSS.
- Status pill padding: 4 px vertical, 8 px horizontal.
- Panel row padding: within 8–12 px.
- Lean compact; whitespace separates semantic groupings only.

### Panel Chrome

- Border-radius: **4 px** on panels and pills.
- Panel border: **1 px solid `#1F2937`**.
- Panel background: **`#121821`**.
- No `box-shadow`.

### Status Pills — Color Map

- Pending: `text-dim` (`#9CA3AF`) on `border` (`#1F2937`) fill.
- Running: info-cyan text on info-cyan-10 %-opacity fill with a 1.5 s ease-in-out opacity pulse (0.6 → 1.0), infinite.
- Done: success-green text on success-green-10 %-opacity fill.
- Failed: error-red text on error-red-10 %-opacity fill.
- Skipped: identical to pending.

Reduced-motion fallback for the running pill: **static 2 px solid info-cyan border** instead of the pulse; layout must not shift when the media query toggles.

### Layout

- Max content width: **1280 px**, centered on wider viewports.
- Desktop-first, primary target ≥1024 px.
- Fixed vertical order: sticky header → cost meter → phase list.
- No sidebar, no tabs, no modals, no toasts.
- Narrower viewports stack phase list and cost meter vertically with no horizontal scroll.

### Motion Budget

Exactly **three** animations are permitted in the dashboard stylesheet; a lint / grep check enforces this:

1. Running-pill pulse (1.5 s ease-in-out opacity 0.6 → 1.0 infinite).
2. Row-update flash (300 ms info-cyan at 15 % opacity fading to transparent).
3. Disconnect-banner fade-out (400 ms).

No `transform: translate`, `scale`, or `rotate` animations. No slide-ins, no parallax. Cost meter total updates silently.

Under `prefers-reduced-motion: reduce`, all animations and short transitions resolve to none or to non-motion alternatives.

### Icons

- Inline SVG only. No icon fonts, no runtime icon libraries.
- Size: 16 px, stroke-width 1.5, color `currentColor`.
- Status pills contain no icons — pill text is the badge.
- Icons appear only on: copy-to-clipboard (phase IDs), external-link (file paths), optional expand/collapse chevron (cost breakdown).

### Tab Identity

- Tab title format, literal: `● ridgeline · <build-name> · <status>` with U+00B7 (`·`) separators.
- Favicon: inline-SVG data-URI, 16 × 16 filled circle, fill reflects status (info-cyan running, success-green done, error-red failed). Updates on status change without page reload; swap is debounced to once per actual status change.
- Header wordmark: lowercase `ridgeline` at 14 px sans in text-dim — not bold, not uppercase, no accompanying glyph.

### Accessibility

- WCAG AA minimum for all text (4.5:1 normal, 3:1 large).
- Baseline palette clears AAA; preserved.
- Every accent-text-on-fill pair contrast-verified ≥4.5:1.
- Focus ring: **2 px solid info-cyan with 2 px offset**, visible on every interactive background (verified per background, not only against page bg).
- Keyboard reachability for all interactive elements.
- `prefers-reduced-motion` honored.
- Dashboard must pass `axe-core` and `pa11y` audits with zero WCAG AA violations in pending, running, done, and failed fixtures.

### Terminal Preflight Summary Format

- No Unicode box-drawing characters (`─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼`).
- Labels `Detected`, `Ensemble`, `Caching`, `enabling` render **bold in full text color**.
- Values render in dim.
- Arrow `→` renders in dim cyan.
- A single blank line separates the detection block from the Ensemble / Caching block.
- TTY prompt line: `Press Enter to continue, Ctrl+C to abort` indented exactly 2 spaces in dim text.
- Non-TTY / CI: prompt line omitted; output appends `(auto-proceeding in CI)` in dim.

### Terminal Semantic Colors

All terminal UI modules route color through a single semantic-color helper — no raw ANSI codes in feature modules.

- `error` → ANSI red (31 / bright 91)
- `success` → ANSI green (32 / 92)
- `warning` → ANSI yellow (33 / 93)
- `info` / running → ANSI cyan (36 / 96)
- `hint` / dim context → dim gray (code 2 with default color)

`NO_COLOR` env var and non-TTY streams strip colors while preserving content.

### Offline Guarantee

- Dashboard runs fully offline on localhost with zero external requests.
- No CDN links, no webfonts, no analytics, no telemetry.
- Disabling the network after initial load does not degrade the dashboard (SSE to localhost continues working).
- Client-side polling fallback activates within 2 s of SSE disconnect and auto-resumes SSE on reconnect.

## Check Command

```bash
npm run lint && npm test && npx tsc --noEmit
```
