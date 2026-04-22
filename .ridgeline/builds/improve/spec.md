# ridgeline 0.8.0 — Flavour Removal, Always-On Sensors, Lean Ensembles

## Overview

Ship a breaking 0.8.0 release on a dedicated branch that eliminates three concrete pains the sole user hits when building downstream Node/TS apps: flavour-flag complexity that makes "forgot a flag → wasted build" a real failure mode, a builder agent blind to visual output, and ensemble orchestration that burns 12+ Claude calls before a single phase builds.

The release deletes `src/flavours/` entirely (all 15 directories) — the canonical agent set already lives in `src/agents/` and the per-flavour prose variants weren't earning their keep. Different project types (software-engineering, game-dev, mobile-app, technical-writing, test-suite, web-game, web-ui) are now served by detection-driven tool selection, not prompt variants. The release also ships Playwright / Claude vision / axe-core / WCAG-contrast as always-available builder tools (selected per-build by detection, no intermediate "capability-pack" abstraction), adds project-signal auto-detection with a preflight summary, halves default ensemble size with an explicit `--thorough` escape hatch, caches stable stage inputs across invocations, skips synthesis when structured specialist verdicts agree, and introduces an opt-in `ridgeline ui` localhost dashboard. Old 0.7.x builds are not migrated; behavior is surfaced via the preflight rather than changed silently. Durable infrastructure (git checkpoints, Greywall/bwrap sandboxing, worktree isolation, state/budget/trajectory stores, linter stack, vitest suite) is preserved.

## Features

### Flavour concept removal

Delete `src/flavours/` and every subdirectory under it (all 15: `data-analysis`, `game-dev`, `legal-drafting`, `machine-learning`, `mobile-app`, `music-composition`, `novel-writing`, `screenwriting`, `security-audit`, `software-engineering`, `technical-writing`, `test-suite`, `translation`, `web-game`, `web-ui`). The canonical agent set already lives in `src/agents/` (core, planners, researchers, specialists, specifiers) — the flavour tree was a near-duplicate whose prose variants did not earn their cost. Project-type differences are now expressed as *tool selection* driven by detection, not as *prompt variants*.

The `--flavour` CLI flag is removed entirely. Supplying it errors immediately with a migration hint; no silent fallback. `flavour.resolve.ts`, `flavour.config.ts`, and `flavour.json` are deleted. The `state.json` `flavour` field is removed (existing 0.7.x state files are not migrated — the preflight surfaces this).

Acceptance criteria:

- Directory `src/flavours/` does not exist after the change (verified by `fs.existsSync` returning false in a vitest).
- `src/agents/core/` contains `builder.md`, `planner.md`, `researcher.md`, `specifier.md`, `reviewer.md`, `refiner.md`, `shaper.md`, `designer.md`, `retrospective.md` (already present today; verified as unchanged baseline).
- `src/agents/{planners,researchers,specialists,specifiers}/` remain the canonical locations for ensemble specialists (unchanged).
- `src/engine/discovery/flavour.resolve.ts` and `src/engine/discovery/flavour.config.ts` are deleted; `agent.registry.ts` resolves agent prompts directly from `src/agents/` with no flavour-dir intermediary.
- Running `ridgeline <cmd> 'intent' --flavour <anything>` exits non-zero with stderr containing the literal substrings `"removed in 0.8.0"` and `"drop the --flavour flag"`. The `--flavour` option is not registered on any command (verified by `ridgeline --help` containing zero occurrences of the word `flavour`/`flavor`).
- Running `ridgeline <cmd> 'intent'` with no flag resolves the canonical agent set and writes no `flavour` key to `state.json`.
- `ridgeline --help` text contains no references to flavour names or the `--flavour` flag.
- No file under `src/` contains the identifiers `Flavour`, `flavour`, `flavor`, or `Flavor` after the change, except where they appear inside string literals emitting the deprecation error (verified by ripgrep).
- No file under `src/` contains the identifier `CapabilityPack` or the string `capability-pack` (grep already returns zero matches today; no capability-pack abstraction is introduced in 0.8.0). Detection maps project signals directly to concrete sensor names — see *Project-signal auto-detection* — with no intermediate pack/group type.
- `ridgeline check` does not warn about missing flavours or packs.
- `fallow` passes on the surviving tree (no dangling imports or dead exports from deleted flavour modules).
- `agnix` passes on the agent prompts under `src/agents/`.
- A single parameterised vitest covers the `--flavour` removal error across all pipeline-entry commands (`shape`, `design`, `spec`, `research`, `refine`, `plan`, `build`, `rewind`, `retrospective`, `create`).
- Tests exercising `src/flavours/software-engineering/` as a file source are deleted; equivalent tests against `src/agents/` replace them where coverage is lost.
- `docs/` references to flavours, `--flavour`, and named flavour types are removed or rewritten to reference the detection flow.
- `package.json` `build` script no longer copies `src/flavours/` into `dist/` (the `rm -rf dist/flavours && cp -r src/flavours dist/flavours` segment is deleted).

### Always-on builder sensors

New `src/sensors/` module exporting four tool adapters the builder invokes directly: Playwright (screenshot + DOM evaluation — the browser substrate), Claude vision (image analysis via the existing Claude CLI path), axe-core (accessibility audit run against a Playwright `Page`), and `wcag-contrast` (contrast ratio checks on design-token hex pairs — independent of Playwright). Each adapter emits `SensorFinding` records. The builder prompt (`src/agents/core/builder.md`) instructs the agent to self-verify with these sensors when the detection report indicates a visual surface. All sensor failures are non-fatal warnings — the builder continues blind.

Per research Rec 2 (axe-core requires a browser DOM; JSDOM drops the `color-contrast` rule), `a11y.ts` and `vision.ts` are consumers of the Playwright sensor's browser `Page`, not peers. When the `playwright` peer dependency is unresolvable or its browser binaries are missing, those two sensors emit a warning `SensorFinding` with the install hint rather than falling back to JSDOM. The contrast sensor stays independent of Playwright (it scores static hex pairs).

Acceptance criteria:

- `src/sensors/` exists and contains exactly four sensor modules (`playwright.ts`, `vision.ts`, `a11y.ts`, `contrast.ts`) plus an `index.ts`.
- Each sensor module default-exports an adapter object with at minimum `{ name: string, run(input): Promise<SensorFinding[]> }` and an explicit TypeScript return type.
- `SensorFinding` interface is exported and has exactly the shape `{ kind: 'screenshot' | 'a11y' | 'contrast' | 'vision', path?: string, summary: string, severity: 'info' | 'warning' | 'error' }`.
- `src/agents/core/builder.md` references all four sensors by name and describes the visual self-verification pattern; the builder tool registry declares the four sensors unconditionally (availability at runtime is gated by detection + peer-dependency resolvability, not by an opt-in flag).
- When a sensor throws, the builder phase logs a single `warn`-level line containing the sensor name and continues; the phase does not abort (verified by a vitest that stubs a sensor to reject and asserts phase success).
- `package.json` declares `playwright` under `peerDependencies` with version range `">=1.57.0 <2.0.0"` and `peerDependenciesMeta: { "playwright": { "optional": true } }`; `axe-core` and `wcag-contrast` are declared under `dependencies`.
- axe-core is injected into the Playwright `Page` via `page.addScriptTag({ path: require.resolve('axe-core') })` rather than depending on `@axe-core/playwright` (which tracks axe-core's `major.minor` non-SemVer-compatibly — see research Rec 2). This keeps the dep tree flat and version-pinned.
- axe-core runs locally against the project's rendered output with no external network calls.
- The Claude vision sensor routes screenshots through the existing Claude CLI subprocess path (same auth/trust boundary as other agent calls).
- Sensor execution happens inside the existing sandbox. When a sandbox environment is detected (Greywall env marker on macOS, `BWRAP_DETECTED` or equivalent on Linux), Playwright launches Chromium with `launchOptions.args = ['--no-sandbox', '--disable-setuid-sandbox']` and a 10-second launch timeout (per research Rec 10). On launch failure or timeout, the Playwright sensor emits a warning `SensorFinding` containing the literal phrase `sandbox-incompatible` and the phase continues, not aborts.
- When Playwright is unresolvable (`require.resolve('playwright')` throws) or the Chromium binary is not installed (`browserType.launch()` emits "browser not found" on first call), `a11y.ts` and `vision.ts` each emit a warning `SensorFinding` with `summary` containing `npm install --save-dev playwright && npx playwright install chromium` and return without attempting a JSDOM fallback.
- Each adapter is unit-tested with stubbed I/O.

### Project-signal auto-detection

New `src/engine/detect/` module scans the working directory and produces a `DetectionReport` used by preflight. Reads `package.json` deps, file extensions, `design.md` presence, and `.ridgeline/` contents.

Acceptance criteria:

- `src/engine/detect/index.ts` exports `async function detect(cwd: string): Promise<DetectionReport>`.
- `DetectionReport` is an exported TypeScript interface with fields `projectType: 'web' | 'node' | 'unknown'`, `isVisualSurface: boolean`, `detectedDeps: string[]`, `hasDesignMd: boolean`, `hasAssetDir: boolean`, `suggestedSensors: Array<'playwright' | 'vision' | 'a11y' | 'contrast'>`, `suggestedEnsembleSize: 2 | 3`.
- Detection sets `isVisualSurface: true` when `package.json` dependencies or devDependencies include any of: `react`, `vue`, `svelte`, `solid-js`, `vite`, `next`, `three`, `phaser`, `pixi.js`, `@babylonjs/core`, `electron`, `react-native`, `expo`.
- Detection sets `isVisualSurface: true` when the working directory contains at least one file matching `**/*.html`, `**/*.tsx`, `**/*.jsx`, `**/*.vue`, or `**/*.svelte` (excluding `node_modules`, `.git`, `.worktrees`, `dist`, `build`).
- Detection sets `hasDesignMd: true` iff `.ridgeline/design.md` exists at the project root.
- When `isVisualSurface` is false and no visual-only deps are found, `suggestedSensors` is an empty array.
- `suggestedEnsembleSize` is `2` unless `--thorough` is passed (the detection function accepts the flag value as an argument), in which case it is `3`.
- Missing `package.json` is handled without throwing — `projectType` defaults to `'unknown'`, `isVisualSurface` is `false`.
- Malformed `package.json` warns (not fatal) and falls back to filesystem-only signals.
- A pure-backend project (express in deps, no html/css/tsx, no design.md) produces `isVisualSurface: false`.
- A React+Vite project with `design.md` produces `isVisualSurface: true` with `suggestedSensors` equal to `['playwright', 'vision', 'a11y', 'contrast']` (any order).
- A project with a `.jsx` file but no visual deps still flags `isVisualSurface: true`.
- Detection completes in under 1 second on a fixture project of ≤100 files (asserted by vitest timing).
- Running detection twice on an unchanged project produces byte-identical serialized reports (deterministic key ordering).

### Preflight detection summary and TTY gate

New `src/ui/preflight.ts` renders the detection summary before any command that spends model tokens. TTY: prints the summary, then blocks on Enter unless `--yes` is passed. Non-TTY / CI: prints the summary with an `(auto-proceeding in CI)` note and continues without blocking. Applies to pipeline-entry commands (`shape`, `design`, `spec`, `research`, `refine`, `plan`, `build`, `rewind`, `retrospective`, `create`); does not apply to inspection-only commands (`ui`, `check`, `clean`, `dry-run`, `catalog`).

Acceptance criteria:

- `src/ui/preflight.ts` exports `async function runPreflight(report: DetectionReport, opts: { yes: boolean, isTTY: boolean }): Promise<void>`.
- Rendered output contains three lines in this order: `Detected  <csv>  →  enabling  <csv>`, `Ensemble  <N> specialists  (use --thorough for 3)`, `Caching   on`.
- Labels `Detected`, `Ensemble`, `Caching`, and `enabling` render bold in full text color; values render dim; the `→` arrow renders in dim cyan (ANSI 36 with dim attribute).
- A single blank line separates the detection block from the Ensemble/Caching block.
- Output contains none of the Unicode box-drawing characters `─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼` (verified by regex).
- When `opts.isTTY === true` and `opts.yes === false`, the function resolves only after a newline is read from stdin (asserted by a vitest that sends no input and expects a pending promise after 200 ms).
- TTY prompt line reads `Press Enter to continue, Ctrl+C to abort` indented exactly 2 spaces in dim text on its own line.
- When `opts.isTTY === false`, output ends with the literal substring `(auto-proceeding in CI)` in dim text, and the function resolves without waiting on stdin.
- When `opts.yes === true` in TTY mode, the function resolves without waiting on stdin and does not print the `(auto-proceeding in CI)` suffix.
- Ctrl+C during preflight exits cleanly with non-zero status and no partial state is written to `.ridgeline/`.
- Preflight runs before any ensemble or builder invocation for pipeline-entry commands — verified by a vitest that stubs the model subprocess and asserts preflight stdout appears before the first model-call log line.
- Preflight is not triggered for `ridgeline ui`, `ridgeline check`, `ridgeline clean`, `ridgeline dry-run`, or `ridgeline catalog`.
- When `isVisualSurface` is true and `playwright` is not resolvable (`require.resolve('playwright')` throws), stdout contains the literal substring `npm install --save-dev playwright && npx playwright install chromium` (both halves on the same line — the package install alone is one step short of a usable browser, per research Rec 9) and the reason phrase `visual surface detected`.
- When detection is ambiguous (e.g. a single `index.html` with no framework), preflight picks the narrower interpretation silently and continues; no interactive disambiguation prompt ships in 0.8.0.
- Snapshot tests cover TTY, `--yes`, and non-TTY renderings.

### Default 2-specialist ensembles with `--thorough` opt-in

`spec`, `plan`, and `research` ensembles default to 2 specialists. `--thorough` raises the count to 3 and enables two-round cross-specialist annotation consistently across those three stages. `--deep-ensemble` is removed as a named flag; specifying it prints a one-line deprecation and maps to `--thorough` for the current run.

Acceptance criteria:

- Default invocation produces exactly 2 specialist calls per ensemble stage (spec, plan, research), verified by trajectory-log assertions with a stubbed specialist invoker.
- `--thorough` produces 3 specialist calls per stage and enables a two-round cross-annotation pass: in round 2, each specialist receives the round-1 verdicts of the other two specialists as input.
- Without `--thorough`, no second annotation round runs; exactly one call per specialist per stage.
- `--deep-ensemble` prints `[deprecated] --deep-ensemble is now --thorough; continuing with --thorough` on stderr (every run, not once per session) and behaves identically to `--thorough` for that run.
- `--thorough` and `--deep-ensemble` specified together: `--thorough` wins, deprecation notice still printed.
- `ridgeline --help` documents `--thorough`; `--deep-ensemble` is not listed but is still accepted with the deprecation warning.
- Ensemble quorum behavior preserved: if one of two specialists fails, synthesis runs on one verdict with a warning; if both fail (or all three under `--thorough`), the ensemble halts.
- Specialist subprocess timeouts count identically to non-zero exits for quorum purposes (per research Rec 6 — Node `spawn()` has no built-in timeout; trapped SIGTERM hangs indefinitely without escalation). The existing SIGTERM→SIGKILL escalation in `src/engine/claude/claude.exec.ts` already implements startup/stall/global timeouts; this spec makes the quorum semantics explicit: any rejection from `invokeClaude` (timeout, non-zero exit, spawn failure) is a "failed specialist" for quorum resolution.
- Default per-call specialist timeout is 180 s (configurable in `settings.json` via an existing key; recommended range 180–600 s). Timeouts are logged to `trajectory.jsonl` with `reason: "timeout"` and the phase/specialist identifier so post-hoc analysis can distinguish timeouts from other failures.
- A vitest stubs `invokeClaude` to resolve one specialist and time out the other, and asserts: (a) synthesis runs on the single survivor with a warning, (b) the timed-out call appears in `trajectory.jsonl` with `reason: "timeout"`, (c) the phase completes with status `done`, not `failed`.
- Tests cover: default-2 count, `--thorough` count=3 + annotation payload contents, `--deep-ensemble` deprecation, quorum fallback with one specialist, halt with zero specialists, timeout-as-failure quorum resolution.

### Structured specialist verdicts with agreement-based synthesis skip

Each specialist emits a parseable structured skeleton alongside its prose in a fenced JSON block with a stage-specific schema. When skeletons match within a strict diff, the synthesizer is skipped and an audit note is appended to the phase artifact. Malformed structured output falls back to always-synthesize.

Acceptance criteria:

- Specialist prompts in `src/agents/specialists/` emit a fenced JSON block with stage-specific fields: spec → `{ sectionOutline: string[], riskList: string[] }`; plan → `{ phaseList: Array<{ id: string, slug: string }>, depGraph: Array<[string, string]> }`; research → `{ findings: string[], openQuestions: string[] }`.
- Parser returns a `SpecialistVerdict` when the JSON block is present and valid; returns `null` otherwise (missing block, malformed JSON, or schema mismatch).
- Agreement detection compares parsed skeletons field-by-field after normalization (strings trimmed, arrays of primitives sorted), using deep-equal: order-sensitive for `phaseList`; order-insensitive for `sectionOutline`, `riskList`, `findings`, `openQuestions`, and `depGraph`.
- When all specialists' skeletons agree under the above rules, the synthesizer is NOT invoked and a line matching `synthesis skipped: N specialists agreed on structured verdict (<stage>)` is appended to the stage's phase artifact (`.ridgeline/builds/*/phases/*.md`).
- When any specialist's parsed verdict is `null` (malformed output), agreement detection returns false, synthesis runs, and a warning is logged.
- When prose diverges but skeletons match, synthesis is still skipped (agreement is defined on skeletons, not prose).
- Agreement detection is always-on at default; there is no flag to disable it.
- When synthesis is skipped, the first specialist's prose artifact becomes the canonical stage artifact, and the audit note is appended after the prose.
- The reviewer's structured verdict gains exactly one new field, `sensorFindings: SensorFinding[]`, with no other schema changes. When no sensors ran, `sensorFindings` is `[]` (not `undefined`).
- The phase artifact markdown includes a "Sensor Findings" section with one bullet per finding when the array is non-empty; when empty, the section is omitted (no empty heading).
- Tests cover: agreeing verdicts → skip + audit note; disagreeing → synthesis; malformed → synthesis + warning; three agreeing under `--thorough` → skip.

### Prompt caching of stable stage inputs

Reshape prompt assembly in `src/engine/claude/agent.prompt.ts` so the stable block (`constraints.md` → `taste.md` if present → `spec.md`) is written to a temp file and loaded via the Claude CLI's `--append-system-prompt-file` flag, while the volatile handoff remains on stdin. Invocations pass `--exclude-dynamic-system-prompt-sections` so per-machine sections (cwd, date, git status) don't poison the shared prefix. Cache invalidation is delegated to the upstream API's server-side content-hash — ridgeline persists no client-side cache key (per research Rec 1, 4, 11; Anthropic prompt-caching docs; Claude Code 2.1.98 changelog).

Note (per research Rec 15, Cline discussion #9892): the Claude Code CLI emits a dynamic header prefix (`cc_version=…;cch=…;`) per subprocess spawn that busts the server-side prefix cache between invocations, so ridgeline's current spawn-per-phase model yields no cross-invocation hits regardless of prompt ordering. Session-continuity strategies (`--resume <session_id>` + `-p`, persistent subprocess with `--input-format stream-json`) are out of scope for 0.8.0 and tracked in Future Considerations. Within a single invocation the rewrite still improves ordering hygiene and enables `cache_read_input_tokens` to be non-zero across intra-run tool turns.

Acceptance criteria:

- `src/engine/claude/agent.prompt.ts` exposes a `buildStablePrompt(parts)` function whose output orders sections exactly as: `constraints.md` → `taste.md` (if present) → `spec.md` — verified by a vitest snapshot. The core agent system prompt (from `src/agents/core/*.md`) is passed separately via `--system-prompt` / `--append-system-prompt` and is not merged into the stable block.
- The stable block is written to a per-invocation temp file (e.g. `os.tmpdir()/ridgeline-stable-<sha256>.md`) and passed to the Claude CLI via `--append-system-prompt-file <path>`; the file is cleaned up on process exit.
- The argv of the spawned Claude CLI subprocess contains `--append-system-prompt-file` and `--exclude-dynamic-system-prompt-sections` when running `-p` invocations — verified by a vitest stub.
- Availability of `--exclude-dynamic-system-prompt-sections` is detected once at startup by parsing `claude --help`; if the flag is absent, the caching code path is a no-op (no error, no flag passed) and a single `info`-level line is logged to `trajectory.jsonl` with `reason: "cli_flag_unavailable"`.
- Given identical `constraints.md`, `taste.md`, and `spec.md` contents across two consecutive invocations, the stable temp file bytes are byte-identical across runs (assertion is on file contents, not on an in-process assembled string).
- If `taste.md` is absent, the stable block still assembles in the specified order with `taste.md` omitted (no placeholder) — verified by vitest.
- Cache invalidation on content change is delegated to the upstream API's content-hash; no `.ridgeline/cache-key.json` or mtime-tracking file is written by ridgeline. Editing any stable file before the next run is sufficient to change the file's bytes and therefore the server-side hash.
- Volatile content (per-phase handoff, current task) is passed on stdin or as the non-cached `-p` prompt argument — never merged into the stable file.
- A local `sha256` of the concatenated stable files is logged to `trajectory.jsonl` under event type `prompt_stable_hash` for diagnostics only — correlates cache behavior with stable-block edits without requiring real-API hits.
- With `--output-format json`, the Claude CLI emits `cache_creation_input_tokens` and `cache_read_input_tokens` per response; both are extracted and logged to `trajectory.jsonl` under the existing phase event so the "caching is working" claim is measurable.
- When the combined stable block is under the model's minimum cacheable prefix (4,096 tokens for Opus 4.x/4.5/4.6/4.7 and Haiku 4.5; 2,048 for Sonnet 4.6), preflight prints a `warning`-level line noting the threshold was not met and caching will be silently skipped upstream. The check uses the same token count the `-p` invocation will see.
- No caching-specific flag is exposed on the CLI — always-on when available; preserved across 0.8.0.

### `ridgeline ui` localhost dashboard

New `ridgeline ui` subcommand spawns a localhost HTTP server serving a single-page dark-mode dashboard: sticky header (build name, elapsed time, status pill, lowercase `ridgeline` wordmark), cost meter (headline total + per-stage breakdown), phase list (ID, slug, status pill, elapsed). Transport is Server-Sent Events with a 2 s polling fallback. All assets ship inline — no webfonts, no CDN, no analytics. Opt-in only; does not affect pipeline behavior.

Acceptance criteria:

- `ridgeline ui [build-name]` starts an HTTP server bound to `127.0.0.1` (not `0.0.0.0`) on default port 4411, falling back to the next free port if taken; `--port` overrides.
- `ridgeline ui --help` prints a usage line containing `ridgeline ui` and exits 0.
- With no `build-name` argument, the dashboard attaches to the most recently modified build under `.ridgeline/builds/`.
- `GET /` returns 200 with `Content-Type: text/html`; body contains the literal `<title>● ridgeline` substring, the lowercase `ridgeline` wordmark, and the hex `#0B0F14` as the page background.
- `GET /events` returns a SSE stream with response headers `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no` (per research Rec 5; WHATWG HTML spec; MDN SSE guide).
- The SSE stream emits exactly three named event types: `event: state` (fired on `state.json` change), `event: budget` (fired on `budget.json` change), and `event: trajectory` (fired when lines are appended to `trajectory.jsonl`). Each dispatch carries a compact one-line JSON `data:` and a monotonically increasing `id:` integer to enable `Last-Event-ID` reconnect recovery; no other event names are emitted.
- On initial connection the server sends a single `retry: 2000` directive so the browser's EventSource reconnect cadence matches the 2 s polling fallback.
- A `: heartbeat\n\n` comment is emitted every 20 s (range 15–25 s acceptable) while the connection is open, to prevent idle proxies / intermediaries from closing the stream.
- When a client reconnects with a `Last-Event-ID` header, the server replays any events with `id > last-event-id` it still holds, then resumes live streaming; the in-memory event buffer holds at minimum the last 200 events per event type (or all events since server start, whichever is smaller).
- File watching strategy (per research Rec 14): `state.json` and `budget.json` use `fs.watch` with a 50 ms trailing-edge debounce and a changed-value diff — events are only dispatched when the parsed content actually changed. `trajectory.jsonl` uses `fs.watch` + a byte-offset tracker: on change, the server seeks to the last-read offset and reads only appended lines, never re-reading the whole file. `fs.watchFile` polling is not used.
- `GET /state` returns a JSON snapshot for the polling fallback.
- When the SSE connection drops, the dashboard JS polls `/state` every 2000 ms ± 100 ms and auto-resumes SSE on recovery.
- Empty state (no build attached): page renders a centered panel whose text contains the substring `No build attached. Run ridgeline <name> "intent" in another terminal, then reload.` with the dashboard port URL on the next line.
- Failed-build state: when `state.json` reports `status: 'failed'`, the header pill text reads `FAILED` in error red, and the failing phase row has `border: 1px solid #EF4444` (or equivalent class producing that computed style); the last trajectory error renders inline under the failing row in the mono stack, full text color.
- Disconnection banner: when the SSE stream drops, a sticky warning-amber banner appears at the top with the copy `Disconnected from ridgeline process. Retrying…` and a spinning info-cyan dot; on reconnect, the banner fades out over 400 ms.
- Design tokens applied exactly as specified in constraints.md: `#0B0F14` bg, `#121821` panel, `#1F2937` border, `#E5E7EB` text, `#9CA3AF` text-dim; 4 px radius; 1 px panel border; no shadows; no gradients; no pure-black backgrounds.
- Status pills: 4 px radius, 4 px vertical / 8 px horizontal padding, 11 px uppercase sans with tracked letter-spacing; color map — pending (`#9CA3AF` text on `#1F2937` fill), running (info-cyan text on info-cyan-10 %-opacity fill with 1.5 s ease-in-out opacity pulse 0.6 → 1.0 infinite), done (success-green text on success-green-10 %-opacity fill), failed (error-red text on error-red-10 %-opacity fill), skipped (identical to pending).
- Under `prefers-reduced-motion: reduce`, the running-pill pulse is replaced by a static 2 px solid info-cyan border and no `@keyframes` pulse is active; layout does not shift when the media query toggles.
- Row-update flash: info-cyan at 15 % opacity fading to transparent over exactly 300 ms; cost-meter total updates silently (no flash, no animation).
- Typography: sans stack `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`; mono stack `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`; sizes are exactly 12, 13, 14, 16, 20 px (no intermediate sizes); phase IDs, costs, elapsed times, and raw values render in mono; headings, labels, body, and pill text render in sans.
- No `@font-face` declarations appear in the served CSS; network panel at page load shows zero font requests and zero cross-origin requests.
- Layout: single scrolling pane in fixed order header → cost meter → phase list; no sidebar, no tabs; content clamped to `max-width: 1280px`, centered on wider viewports; renders without horizontal scroll at ≥1024 px; narrower viewports stack phase list and cost meter vertically without horizontal scroll.
- Tab title renders literally as `● ridgeline · <build-name> · <status>` with U+00B7 separators.
- Favicon is an inline-SVG data-URI (16 × 16 filled circle) whose fill is info-cyan `#06B6D4` when running, success-green `#10B981` when done, and error-red `#EF4444` when failed; updates on status change without a page reload. The favicon `href` is only reassigned when the mapped color actually changes (last-value compared in client JS) — no time-based debounce (per research Rec 13; browsers no-op identical data-URI assignments automatically).
- Header wordmark renders lowercase `ridgeline` at 14 px sans in text-dim — not bold, not uppercase, no accompanying glyph.
- Icons are inline SVG only at 16 px with stroke-width 1.5 and `color: currentColor`; no icons appear on status pills (pill text is the badge); icons appear only on copy-to-clipboard (phase IDs), external-link (file paths), and optional expand/collapse chevron on cost breakdown.
- Motion budget: exactly three animations — running-pill pulse, row flash, disconnect-banner fade — present in the stylesheet; no transform translate/scale/rotate animations appear in computed styles.
- Accessibility: all interactive elements are keyboard-reachable via Tab; focus ring is 2 px solid info-cyan at 2 px offset and visible on every interactive background (verified per background, not only against page bg).
- WCAG AA: text `#E5E7EB` on `#0B0F14` achieves ≥16:1 contrast; text-dim `#9CA3AF` on `#0B0F14` achieves ≥7.5:1; each accent text color on its 10 %-opacity composited fill is contrast-verified ≥4.5:1 via `wcag-contrast` and brightened if short.
- A new `src/ui/contrast.ts` module exports `brightenForContrast(accentHex: string, bgHex: string, targetRatio?: number): string` implementing the deterministic HSL-stepper algorithm (per research Rec 4, since `wcag-contrast` is measurement-only and ships no brightening helper). Algorithm, in order: (1) composite the 10 %-opacity accent over `bgHex` to get the effective pixel color; (2) parse the accent to HSL; (3) iterate L upward in 2 % increments, re-measuring `wcag-contrast.hex(accent, effectiveFill)` on each step, until the score ≥ `targetRatio` (default 4.5); (4) cap L at 95–98 % — on loop cap, fall back to `--text #E5E7EB`. All accent/fill adjustments are computed at build time from the palette in constraints.md and baked into the served CSS — never computed at page load.
- A vitest asserts `brightenForContrast('#06B6D4', '#0B0F14')` returns an unchanged or near-unchanged value because cyan on the 10 %-opacity-cyan-over-`#0B0F14` fill already clears 4.5:1 (~7.5:1) — the loop is a fallback for future accent edits, not a present-tense necessity for the specified palette.
- The served page passes `axe-core` with zero violations at impact level `serious` or `critical` when rendered with `state.json` in each of four fixtures (pending, running, done, failed); same audit passes `pa11y` with zero WCAG AA violations.
- Loading the dashboard with external network disabled produces only same-origin requests to the ridgeline local port; `<link rel="stylesheet">` and `<script>` tags reference no remote origins; no Google Fonts, Typekit, analytics, or telemetry snippets present.
- `Ctrl+C` on the `ridgeline ui` process shuts down the server cleanly within 2 seconds.
- No modals or toasts are used for any state.

### Terminal semantic colors

Update `src/ui/{spinner,logger,output,prompt,summary,transcript}.ts` to route color through a single semantic-color helper shared with the preflight renderer. Error → ANSI red, success → green, warning → yellow, info → cyan, hint → dim gray. Dim styling is preferred for context the user already has; full color is reserved for new information. Semantic colors are never used for decoration.

Acceptance criteria:

- All six named terminal modules route color through a single semantic-color helper (e.g. `src/ui/color.ts`); no raw ANSI escape codes appear in feature modules — verified by grep.
- Error output emits ANSI red (code 31 or bright 91); success emits green (32 / 92); warning emits yellow (33 / 93); info/running emits cyan (36 / 96); hint text emits dim gray (code 2 with default color).
- User-typed context (project name, CWD, echoed input) renders in dim style.
- When `NO_COLOR` env var is set or the stream is not a TTY, colors are stripped but content is identical — verified by vitest.
- A grep check for misuse (e.g. a cyan emit on a non-info/running code path) returns zero results.

### Dev-server port convention for Playwright

The Playwright sensor resolves the running dev server by reading an optional dev-server-port declaration in `shape.md`; otherwise it probes a fixed short list of common ports via HTTP HEAD, in order. Since `shape.md` has no YAML front matter today (verified at `src/commands/shape.ts:14-172`), the declaration uses a dedicated `## Runtime` section matching existing bullet style rather than a top-level key (per research Rec 3).

Acceptance criteria:

- `SHAPE_OUTPUT_SCHEMA` in `src/commands/shape.ts` gains an optional `runtime?: { devServerPort?: number }` field.
- `formatShapeMd` renders a new trailing `## Runtime` section when `runtime.devServerPort` is set. Rendered line format, literal: `- **Dev server port:** 5173` (bold label, space, integer, no trailing punctuation). When `runtime` is absent or empty, the `## Runtime` section is omitted entirely (no empty heading).
- The Playwright sensor parses the port with the regex `/^\s*-\s*\*\*Dev server port:\*\*\s+(\d+)\s*$/m` anchored to a line within a `## Runtime` heading block. On a successful match, the port is used directly with no probing.
- When the `## Runtime` section is absent or the regex does not match, the sensor probes `5173`, `3000`, `8080`, `4321` in that order with a 250 ms timeout per probe, using the first that returns any HTTP status.
- Total probe time is capped at 1 s; if no probe succeeds, the sensor emits a `SensorFinding` with `severity: 'warning'` and `summary` containing `no dev server detected`, and the phase continues.
- No other ports are probed — verified by vitest asserting the probe call list.
- Malformed port declaration (non-numeric, out of range `[1, 65535]`, or multiple `## Runtime` sections) falls back to probing with a warn-level log line; parse errors never throw.
- YAML front matter is explicitly not used for this declaration — preserves the project's pure-Markdown shape.md convention.

### Version bump and branch cutover

Bump `package.json` `version` to `0.8.0` on the 0.8.0 branch. Update `CHANGELOG.md` with a 0.8.0 entry documenting breaking changes and new features. Set a Node engines floor that matches Playwright's active-support baseline and matches the `@types/node@22` dev-time baseline already present in devDependencies. When the branch is green, cut over to main via fast-forward or merge — no force-push.

Acceptance criteria:

- `package.json` `version` reads exactly `0.8.0` at the tip of the 0.8.0 branch.
- `package.json` gains an `engines` field: `"engines": { "node": ">=20.0.0" }` (per research Rec 8 — Playwright deprecates Node 18 as of 1.54 and `@types/node@22` is the dev baseline; Node 20 is LTS through mid-2026). The field is currently absent — this adds it; `constraints.md` in this build has been updated to reflect the addition. Flag the addition explicitly in the CHANGELOG Breaking section.
- `package.json` declares the `playwright` peer dependency with range `">=1.57.0 <2.0.0"` and `peerDependenciesMeta: { "playwright": { "optional": true } }` — 1.57 is where Chrome-for-Testing landed and where `page.accessibility` was removed in favor of axe-core (per research Rec 7).
- `CHANGELOG.md` contains an entry with heading `## 0.8.0` containing Added / Changed / Removed / Breaking sections.
- Breaking section explicitly lists: deletion of `src/flavours/` and the `--flavour` flag, removal of the `state.json` `flavour` field, removal of `--deep-ensemble` (mapped to `--thorough` with deprecation notice), no migration for 0.7.x builds, and the new `engines.node: ">=20.0.0"` floor. The entry notes that no capability-pack abstraction is introduced — tool selection is driven by detection.
- Added section enumerates at minimum: always-on sensors, preflight detection, default-2 ensembles, `--thorough`, prompt caching, `ridgeline ui`.
- `docs/` references to `--flavour`, named flavour types, and `--deep-ensemble` are updated or removed; content under `plans/` is untouched.
- The 0.8.0 branch builds cleanly with `npm run lint && npm test && npx tsc --noEmit` (all exit 0) before cutover.
- Cutover to main is done via fast-forward or merge; no force-push to main is used.

### Vitest coverage for new code paths

Extend (not rewrite) the existing vitest suite. Tests that exercise the deleted `src/flavours/` tree are removed in the same change. New tests cover sensor adapters, detection, preflight, ensemble reduction, structured-verdict agreement, `--flavour` removal errors, `--thorough` wiring, prompt assembly order, and dashboard smoke tests.

Acceptance criteria:

- At least one vitest file exercises each of: (a) the `--flavour` removal error on every pipeline-entry command (parameterised); (b) `DetectionReport` field population for five or more fixture projects (React+Vite with design.md, pure Node, pure HTML, Vue+Vite, monorepo root-only); (c) preflight TTY block vs `--yes` vs non-TTY pass-through; (d) specialist call count of 2 without `--thorough` and 3 with; (e) structured-verdict agreement skip, disagreement synthesis, and malformed-output fallback; (f) each of the four sensor adapters with stubbed I/O; (g) prompt assembly order snapshot and cache-boundary marker placement; (h) dashboard server smoke test (starts, serves HTML, SSE endpoint responds).
- Dashboard tests include snapshot or DOM-assertion coverage for empty, running, failed, and disconnected states.
- Contrast-verification test loads each accent/fill pair and asserts ≥4.5:1 via `wcag-contrast`.
- Reduced-motion test simulates the media query and asserts no active animations on the running pill.
- Offline test loads the dashboard with outbound network blocked and asserts all requests are same-origin.
- `npm test` exits 0 on the 0.8.0 branch.
- No existing test file is deleted except those that import from `src/flavours/` or exercise flavour-resolution paths.

## In Scope

- Delete `src/flavours/` entirely (all 15 directories) from disk; do not rename to `legacy/`.
- Treat `src/agents/` as the single canonical agent set; update `src/agents/core/builder.md` to reference all four sensors and the visual self-verification pattern.
- Remove the `--flavour` CLI flag from every command; `flavour.resolve.ts`, `flavour.config.ts`, and `flavour.json` are deleted.
- No capability-pack abstraction is introduced; detection maps signals directly to concrete sensor names.
- `src/sensors/` with `playwright.ts`, `vision.ts`, `a11y.ts`, `contrast.ts`, and `index.ts`; each adapter returns `SensorFinding[]`.
- `playwright` in `peerDependencies`; `axe-core` and `wcag-contrast` in `dependencies`.
- `src/engine/detect/` producing `DetectionReport` with the exact field set above.
- `src/ui/preflight.ts` rendering the three-line summary in the exact format.
- Default 2 specialists for spec, plan, research; `--thorough` raises to 3 and enables two-round cross-annotation.
- `--deep-ensemble` prints a per-run deprecation line and maps to `--thorough` for the current run.
- Structured specialist verdicts with fenced JSON blocks and stage-specific schemas.
- Agreement-based synthesis skip with audit line appended to the phase artifact.
- Malformed verdict JSON forces synthesis (never hides divergence).
- Prompt assembly orders system → `constraints.md` → `taste.md` → `spec.md` → volatile with a cache-boundary marker.
- `ridgeline ui` bound to `127.0.0.1`, single-pane dashboard (header, cost meter, phase list), SSE with 2 s polling fallback, fully offline assets.
- Dashboard dark-mode only, desktop-first (≥1024 px primary), 1280 px max content width.
- Exact palette and token set per constraints.md `## Design Tokens`.
- Reviewer verdict gains exactly one field: `sensorFindings: SensorFinding[]`.
- Dev-server port: `shape.md` override or probe `5173`, `3000`, `8080`, `4321`.
- Terminal semantic color helper consolidates usage across UI modules.
- Version bump to 0.8.0 with CHANGELOG entry; cutover to main via fast-forward or merge.
- Extend existing vitest suite; delete only tests that import from `src/flavours/` or exercise flavour-resolution paths.
- `docs/` updated for new flags, removed flags (`--flavour`, `--deep-ensemble`), and the flavour-concept removal.
- `npm run lint` passes after each task per `CLAUDE.md`.

## Out of Scope

- Mastra migration, block library extraction, monorepo split.
- Base+overlay composable-layer refactor of the agent prompt tree.
- Multi-model abstraction or lifting the Claude CLI subprocess dependency.
- Visual pipeline / node-graph editor for wiring agents.
- Tldraw / canvas workspaces.
- Migration scripts for 0.7.x `.ridgeline/builds/*` artifacts.
- Keeping any `src/flavours/` directory under `legacy/` or as dormant config.
- Restoring the `--flavour` flag, per-flavour prompt variants, or flavour-specific prose customization (software-engineering, game-dev, mobile-app, technical-writing, test-suite, web-game, web-ui differences are served by tool selection and detection, not prose).
- Reintroducing a capability-pack / tool-group abstraction; detection picks sensors directly.
- Game-specific, mobile-specific, or audio-specific sensors beyond the four named.
- Touching catalog dependencies (`sharp`, `colorthief`, `free-tex-packer-core`) or catalog behavior.
- Replacing the linter stack (`oxlint`, `markdownlint`, `agnix`, `fallow`).
- Rewriting the existing test suite.
- Changing sandboxing providers or the git/worktree/checkpoint model.
- Acting on any content in `plans/` (`mastra-redesign`, `project1-block-library`, `project2-ridgeline-monorepo`, `refactor-composable-layers`).
- Telemetry, external reporting, cloud state, analytics.
- Backwards-compatibility shims for 0.7.x flag names beyond the single `--deep-ensemble` → `--thorough` mapping.
- Light mode, theme toggle, or user-customizable dashboard palettes.
- Dashboard sidebar, tabs, split layout, modals, toasts, or a component library beyond the single-pane surface.
- Mobile polish (touch targets, hamburger menus).
- Authentication, routing, or multi-build views in `ridgeline ui`.
- End-to-end browser tests of the dashboard.
- Interactive disambiguation prompts in preflight for ambiguous projects (picks narrower silently).
- Multi-root / monorepo nested `package.json` handling beyond root-level detection.
- Migrating 0.7.x build artifacts to 0.8.0 format.

## Future Considerations

Captured from research for future iterations; explicitly not part of 0.8.0.

- **Cross-invocation prompt-cache reuse.** The Claude Code CLI emits a dynamic header prefix (`cc_version=…;cch=…;`) per subprocess spawn that busts the server-side prefix cache between invocations (per research Rec 15; Cline discussion #9892). Full cross-spawn cache hits would require either session-continuity via `--resume <session_id>` + `-p`, or a persistent Claude CLI subprocess using `--input-format stream-json`. Both are a deeper architectural change than the 0.8.0 prompt-assembly rewrite and are deferred.
- **1-hour cache TTL.** Anthropic offers a 1-hour cache TTL at 2× write cost; the 5-minute default is sufficient for intra-build flows and the 2× write cost is not justified for a local CLI today.
- **Node 22 engines floor.** `@types/node@22` is the dev-time baseline and Node 22 ships stable `node:test`, so a future bump from `>=20` to `>=22` is a small change worth revisiting when a feature requires it.
- **Headless-browser dashboard e2e.** Smoke-testing the dashboard server (HTML + SSE + state endpoints) covers 0.8.0 acceptance; full headless-browser assertions on computed styles, focus rings, and reduced-motion behavior are deferred.
- **Additional sensor kinds.** Game-specific (input latency, FPS capture), mobile-specific (device-frame screenshots), and audio-specific sensors are out of scope for 0.8.0 but fit the adapter shape if added later.
