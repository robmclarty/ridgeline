# Preflight, Detection, and Sensors

Ridgeline 0.8.2 replaced the user-selected flavour taxonomy with a
detection-driven flow. Before any pipeline-entry command runs, ridgeline
scans the project, prints what it found, names the sensors it will enable,
confirms the ensemble size, and waits for you to press Enter. The same
detection report drives the builder's always-on sensor loop, which runs
after every phase and feeds findings back to the reviewer.

This page covers:

- The preflight summary format and TTY gating
- The four always-on builder sensors
- The `shape.md` `## Runtime` port convention
- Structured specialist verdicts and agreement-based synthesis skip
- Prompt caching of stable stage inputs
- The `ridgeline ui` localhost dashboard

## Preflight

Every pipeline-entry command (`ridgeline [build-name]`, `shape`, `design`,
`spec`, `research`, `refine`, `plan`, `build`, `rewind`, `retrospective`)
runs the preflight block before doing real work. Non-pipeline commands
(`catalog`, `dry-run`, `clean`, `check`, `ui`) skip it.

Under a TTY the output looks like this:

```text
Detected   react, vite, design.md   →   enabling   Playwright, vision, pa11y, contrast

Ensemble   2 specialists   (use --thorough for 3)
Caching    on
  Press Enter to continue, Ctrl+C to abort
```

In CI (no TTY) the prompt line is replaced with a dim
`(auto-proceeding in CI)` note and the command continues without pausing.

### Flags

| Flag | Applies to | Description |
|------|------------|-------------|
| `--thorough` | all pipeline-entry commands | Dispatch 3 specialists with two-round cross-annotation instead of the default 2. |
| `-y`, `--yes` | all pipeline-entry commands | Skip the Enter-to-continue prompt even under TTY. Useful for scripts and local automation. |

### Detection

The detector (`src/engine/project-type.ts`) returns a `DetectionReport`:

```ts
interface DetectionReport {
  projectType: "node" | "web" | "unknown"
  detectedDeps: string[]          // sorted, from package.json
  visualFileExts: string[]        // sorted, populated only when no visual dep matched
  isVisualSurface: boolean
  hasDesignMd: boolean            // .ridgeline/design.md present
  hasAssetDir: boolean            // assets/ | public/ | static/
  suggestedSensors: string[]      // ['playwright', 'vision', 'a11y', 'contrast'] when visual
  suggestedEnsembleSize: number   // 2 by default, 3 with --thorough
}
```

A project counts as a visual surface when any of these appear: React, Vue,
Svelte, Solid, Vite, Next, Three, Phaser, Pixi, Babylon, Electron, React
Native, or Expo in `package.json`; or one of `*.html`, `*.tsx`, `*.jsx`,
`*.vue`, `*.svelte` on disk (excluding `node_modules`, `.git`, `.worktrees`,
`dist`, `build`, `.ridgeline`, `coverage`, `fixtures`). When the file scan
is the trigger, the matched extensions surface in `visualFileExts` so the
preflight banner can name them.

### Install hint

When the project is a visual surface but `playwright` is not resolvable, the
preflight appends an install-hint line before the prompt:

```text
warning: visual surface detected; install Playwright to enable screenshot, a11y, and vision sensors
  hint: npm install --save-dev playwright && npx playwright install chromium
```

Preflight does not block on a missing Playwright — the sensors that need it
will emit warnings at phase time and the phase continues.

## The four always-on sensors

After each phase's builder commits its work, ridgeline runs any sensors the
`DetectionReport` suggested, persists their findings to
`<buildDir>/sensors/<phaseId>.json`, and threads them into the reviewer's
verdict via a new `sensorFindings` field. Sensor failures are non-fatal
warnings — the phase continues even if every sensor is unavailable.

| Sensor | What it does | External dep |
|--------|--------------|--------------|
| `playwright` | Launches Chromium against the detected dev-server port and captures a full-page screenshot. | `playwright` (peer dependency, optional) |
| `vision` | Routes the captured screenshot through Claude to describe what's actually rendered: layout, visible elements, color usage, obvious defects. | Uses the existing Claude CLI trust boundary — no extra dep. |
| `a11y` | Injects `axe-core` into the Playwright page and reports WCAG-AA violations with impact, description, and node counts. Fully offline. | `axe-core` (direct dep) |
| `contrast` | Scores design-token hex pairs from `.ridgeline/design.md` with `wcag-contrast` and flags pairs below 4.5:1. Runs independently of Playwright. | `wcag-contrast` (direct dep) |

Sandbox-compatible: when ridgeline detects a greywall / container
environment (`RIDGELINE_SANDBOX`, `GREYWALL_ACTIVE`, or `container` env
markers), the Playwright launcher switches to
`--no-sandbox --disable-setuid-sandbox`. If the browser still cannot launch,
the sensor emits a `sandbox-incompatible` warning and the phase continues.

## The `shape.md` `## Runtime` convention

To skip the Playwright sensor's `5173 → 3000 → 8080 → 4321` probe chain,
declare the dev-server port in `shape.md`:

```markdown
## Runtime

- **Dev server port:** 5173
```

The port is parsed as a strict integer in `1..65535`. Multiple `## Runtime`
blocks or multiple port lines in one block are rejected as malformed and
fall back to the probe chain with a stderr warning. The block is optional —
when absent, the probe chain is used.

## Structured specialist verdicts

Specifier, planner, and researcher ensembles (2 specialists by default, 3
with `--thorough`) now emit a structured verdict skeleton alongside their
output:

- Specifier → `{ sectionOutline: string[], riskList: string[] }`
- Planner → `{ phaseList: Array<{ id, slug, dependsOn? }>, depGraph: Array<{ from, to }> }`
- Researcher → `{ findings: string[], openQuestions: string[] }`

If every surviving specialist returns a byte-identical skeleton
(normalized for trim, sort, and order-insensitivity on the unordered
collections), the synthesizer is skipped: the first specialist's draft is
promoted to the canonical artifact and a single audit line is appended
noting how many specialists agreed:

```text
synthesis skipped: 2 specialists agreed on structured verdict (plan)
```

Disagreement → synthesis runs as normal. Malformed JSON output →
synthesis runs with a warning. A single-survivor scenario (the other
specialist timed out or failed) → synthesis runs on one verdict with a
warning.

## Prompt caching of stable stage inputs

Builder and reviewer invocations assemble a stable system-prompt block
(`constraints.md → taste.md → spec.md`, in that order, skipping files that
don't exist), write it to
`os.tmpdir()/ridgeline-stable-<sha256>.md`, and pass it to the Claude CLI
via `--append-system-prompt-file <path>` and
`--exclude-dynamic-system-prompt-sections`. The path is hash-named so
identical content reuses one file across invocations.

Cache metrics from each invocation are written to the trajectory stream:

```json
{"type": "build_complete", "cacheReadInputTokens": 12340, "cacheCreationInputTokens": 0}
```

A preflight warning fires when the stable block is smaller than the
minimum-cacheable-size threshold for the selected model
(4,096 tokens for opus/haiku, 2,048 for sonnet) — caching won't kick in
until the block grows past the threshold.

The caching path degrades gracefully on older Claude CLI versions: if
`--exclude-dynamic-system-prompt-sections` isn't available, ridgeline logs
`cli_flag_unavailable` once per process and continues without caching.

## The `ridgeline ui` dashboard

`ridgeline ui [build-name] [--port <n>]` serves a dark-mode monitoring
dashboard for the build. Defaults:

- Bind address: `127.0.0.1` only — the dashboard is never exposed externally.
- Port: `4411`, with 30-port forward fallback on `EADDRINUSE`.
- Build selection: the most recently modified directory under
  `.ridgeline/builds/*` when no name is given; an explicit name attaches to
  that specific build.
- Transport: Server-Sent Events from `GET /events`, with a 2 s polling
  fallback against `GET /state` on disconnect. Both endpoints return
  the same `DashboardSnapshot` schema.

### Offline guarantee

The dashboard makes zero outbound requests:

- System font stacks only (`-apple-system, BlinkMacSystemFont, 'Segoe UI',
  sans-serif` and `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`).
  No `@font-face`, no CDN webfonts.
- Inline SVG favicon (`data:image/svg+xml,...`) whose fill reflects the
  current build status (info-cyan running, success-green done, error-red
  failed).
- Inline CSS + inline vanilla JS — no bundler, no framework, no external
  script tags.
- All assets served from the local ridgeline process; disabling the
  network after initial load does not degrade the dashboard.

### States

- **No build attached** — centered panel with the message "No build
  attached. Run `ridgeline <name> "intent"` in another terminal, then
  reload." plus the dashboard URL.
- **Running** — header pill `RUNNING`, info-cyan pulse on the active phase
  (static 2 px border under `prefers-reduced-motion: reduce`), cost meter
  updates silently.
- **Done** — header pill `DONE`, all phases green.
- **Failed** — header pill `FAILED`, the failing phase row gains a
  1 px error-red border, and the last trajectory error renders inline in
  monospace.
- **Disconnected** — sticky warning-amber banner at top
  (`Disconnected from ridgeline process. Retrying…`) with an info-cyan
  spinner dot. Auto-recovers silently on reconnect (the banner fades out
  over 400 ms).

### Accessibility

- Every accent/fill pair is contrast-verified ≥4.5:1 at stylesheet render
  time via `wcag-contrast` — the brightened text color is baked into the
  served CSS.
- WCAG AA minimum for all text (4.5:1 normal, 3:1 large); the baseline
  palette clears AAA (text on background ≥15:1).
- Focus ring: 2 px solid info-cyan with 2 px offset, visible on every
  interactive background.
- `prefers-reduced-motion: reduce` honored: the running-pill pulse, row
  update flash, and disconnect banner fade are all disabled or replaced.
