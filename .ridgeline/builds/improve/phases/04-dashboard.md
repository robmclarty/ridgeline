---
depends_on: [01b-detection-preflight-color]
---
# Phase 4: ridgeline ui localhost dashboard

## Goal

Ship the opt-in `ridgeline ui` localhost dashboard — a single-pane dark-mode monitoring surface served fully offline from the local ridgeline process. Vanilla HTML + inline CSS + vanilla JS served by Node's built-in `http` module on `127.0.0.1`, with a Server-Sent Events stream (state / budget / trajectory) plus a 2 s polling fallback. All assets are inline: no webfonts, no CDN, no analytics, no telemetry.

When the phase completes: `ridgeline ui [build-name]` attaches to a build (most recently modified by default), binds to `127.0.0.1` on port 4411 (with free-port fallback and `--port` override), and serves `GET /`, `GET /state`, `GET /events`. The SSE stream emits exactly three named event types, supports `Last-Event-ID` replay from an in-memory buffer of ≥200 events per type, heartbeats every ~20 s, and tracks `trajectory.jsonl` via a byte-offset tracker (never re-reading the whole file). The served page meets every design token in `constraints.md` exactly: palette, typography stacks and the `{12, 13, 14, 16, 20}` px scale, 4 px spacing unit, 4 px radius, 1 px border, status pill color map, 1.5 s ease-in-out running pulse with reduced-motion fallback to a static 2 px info-cyan border (no layout shift), 300 ms row-update flash, 400 ms disconnect-banner fade, inline-SVG favicon that updates color on status change without reload.

A new `src/ui/contrast.ts` exports `brightenForContrast(accentHex, bgHex, targetRatio?)` implementing a deterministic HSL-stepper used at build-time to bake verified accent/fill pairs into the served CSS — never computed at page load. WCAG AA contrast is verified per accent/fill pair via `wcag-contrast`. The page passes `axe-core` and `pa11y` with zero serious/critical violations across four state fixtures.

This phase is parallel-safe with phase 3 (lean ensembles / caching) — they touch disjoint files. The dashboard reads `state.json`, `budget.json`, and `trajectory.jsonl` as opaque JSON and tolerates the new fields phase 3 adds without coordination.

## Context

Phase 1a deleted `src/flavours/` and added `axe-core` and `wcag-contrast` as direct dependencies; phase 1b shipped the semantic color helper (`src/ui/color.ts`). The dashboard does NOT use the terminal color helper directly (it serves CSS, not ANSI), but the same semantic vocabulary should map onto the served palette — error/success/warning/info accents come from the design tokens table.

Preflight is NOT triggered for `ridgeline ui` (criterion 27 of phase 1b) — verify this remains true here.

The dashboard's contrast verification uses `wcag-contrast` (declared as a direct dep in phase 1a). The same package backs the contrast sensor in phase 2; that does not block this phase.

Existing artifacts the dashboard reads from `.ridgeline/builds/<name>/`:

- `state.json` — phase status, build status, etc.
- `budget.json` — cost totals + per-stage breakdown
- `trajectory.jsonl` — append-only event log

Phase 3 adds new event types to `trajectory.jsonl` (`prompt_stable_hash`, cache token counters, `reason: "timeout"` records). The dashboard must tolerate unknown fields gracefully — the `trajectory` SSE event payload is the raw JSON line.

## Acceptance Criteria

### CLI subcommand and server binding

1. `src/commands/ui.ts` registers the `ridgeline ui [build-name]` subcommand. Running it starts an HTTP server bound to `127.0.0.1` (never `0.0.0.0`) on default port 4411, falling back to the next free port when 4411 is taken; `--port` overrides.
2. `ridgeline ui --help` prints a usage line containing `ridgeline ui` and exits 0.
3. With no `build-name` argument, the dashboard attaches to the most recently modified build under `.ridgeline/builds/`.
4. Preflight is NOT triggered for `ridgeline ui` (verified by a vitest stubbing the model subprocess path and asserting no preflight stdout appears).
5. `Ctrl+C` on the `ridgeline ui` process shuts down the server cleanly within 2 seconds.

### HTTP endpoints

6. `GET /` returns 200 with `Content-Type: text/html`; body contains the literal `<title>● ridgeline` substring, the lowercase `ridgeline` wordmark, and the hex `#0B0F14` as the page background.
7. `GET /state` returns a JSON snapshot for the polling fallback.
8. `GET /events` returns an SSE stream with response headers `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
9. The dashboard exposes exactly these three local endpoints; no other paths are routed.

### SSE event semantics

10. The SSE stream emits exactly three named event types: `event: state` (fired on `state.json` change), `event: budget` (fired on `budget.json` change), `event: trajectory` (fired when lines are appended to `trajectory.jsonl`). No other event names are emitted.
11. Each dispatch carries a compact one-line JSON `data:` and a monotonically increasing `id:` integer.
12. On initial connection the server sends a single `retry: 2000` directive so the browser's EventSource reconnect cadence matches the 2 s polling fallback.
13. A `: heartbeat\n\n` comment is emitted every 20 s (range 15–25 s acceptable) while the connection is open.
14. When a client reconnects with a `Last-Event-ID` header, the server replays any events with `id > last-event-id` it still holds, then resumes live streaming. The in-memory event buffer holds at minimum the last 200 events per event type (or all events since server start, whichever is smaller).

### File watching

15. `state.json` and `budget.json` use `fs.watch` with a 50 ms trailing-edge debounce and a changed-value diff — events are only dispatched when the parsed content actually changed.
16. `trajectory.jsonl` uses `fs.watch` + a byte-offset tracker: on change, the server seeks to the last-read offset and reads only appended lines, never re-reading the whole file.
17. `fs.watchFile` polling is not used (verified by grep across `src/ui/dashboard/` and `src/commands/ui.ts`).

### Polling fallback

18. When the SSE connection drops, the dashboard JS polls `/state` every 2000 ms ± 100 ms and auto-resumes SSE on recovery.

### State rendering

19. Empty state (no build attached): page renders a centered panel whose text contains the substring `No build attached. Run ridgeline <name> "intent" in another terminal, then reload.` with the dashboard port URL on the next line.
20. Failed-build state: when `state.json` reports `status: 'failed'`, the header pill text reads `FAILED` in error red, and the failing phase row has `border: 1px solid #EF4444` (or equivalent class producing that computed style); the last trajectory error renders inline under the failing row in the mono stack, full text color.
21. Disconnection banner: when the SSE stream drops, a sticky warning-amber banner appears at the top with the copy `Disconnected from ridgeline process. Retrying…` and a spinning info-cyan dot; on reconnect, the banner fades out over 400 ms.

### Design tokens — palette

22. CSS custom properties on `:root`: `--bg: #0B0F14`, `--panel: #121821`, `--border: #1F2937`, `--text: #E5E7EB`, `--text-dim: #9CA3AF`, `--error: #EF4444`, `--success: #10B981`, `--warning: #F59E0B`, `--info: #06B6D4`.
23. Hex values are referenced only via `var(--token)` in component rules; no inline hex repetition (verified by grep — hex values appear only inside the `:root` block and the favicon SVG strings).
24. No gradients anywhere; no pure-black (`#000`) backgrounds; no drop shadows.

### Design tokens — chrome

25. Panel chrome: 4 px `border-radius`, `1px solid var(--border)`, `var(--panel)` background, no `box-shadow`.
26. Status pills: 4 px radius, 4 px vertical / 8 px horizontal padding, 11 px uppercase sans with tracked letter-spacing.
27. Pill color map: pending `#9CA3AF` text on `#1F2937` fill; running info-cyan text on info-cyan-10%-opacity fill with a 1.5 s ease-in-out opacity pulse 0.6 → 1.0 infinite; done success-green text on success-green-10%-opacity fill; failed error-red text on error-red-10%-opacity fill; skipped identical to pending.

### Design tokens — typography

28. Sans stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`.
29. Mono stack: `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`.
30. Font sizes are exactly `12, 13, 14, 16, 20` px — no intermediate sizes appear in rendered output (verified by grep on the served CSS).
31. Phase IDs, costs, elapsed times, and raw values render in mono; headings, labels, body, and pill text render in sans.
32. No `@font-face` declarations appear in the served CSS; network panel at page load shows zero font requests and zero cross-origin requests.

### Design tokens — layout

33. Single scrolling pane in fixed order: header → cost meter → phase list. No sidebar, no tabs.
34. Content clamped to `max-width: 1280px`, centered on wider viewports; renders without horizontal scroll at ≥1024 px; narrower viewports stack phase list and cost meter vertically without horizontal scroll.

### Tab identity

35. Tab title renders literally as `● ridgeline · <build-name> · <status>` with U+00B7 separators.
36. Favicon is an inline-SVG data-URI (16 × 16 filled circle) whose fill is info-cyan `#06B6D4` when running, success-green `#10B981` when done, and error-red `#EF4444` when failed; updates on status change without a page reload.
37. The favicon `href` is only reassigned when the mapped color actually changes (last-value compared in client JS) — no time-based debounce.
38. Header wordmark renders lowercase `ridgeline` at 14 px sans in text-dim — not bold, not uppercase, no accompanying glyph.

### Icons

39. Inline SVG only at 16 px with `stroke-width: 1.5` and `color: currentColor`; no icons appear on status pills (pill text is the badge); icons appear only on copy-to-clipboard (phase IDs), external-link (file paths), and optional expand/collapse chevron on cost breakdown.

### Motion

40. Exactly three animations live in the stylesheet — running-pill pulse, row flash, disconnect-banner fade. No `transform: translate`, `scale`, or `rotate` animations appear in computed styles.
41. Row-update flash: info-cyan at 15 % opacity fading to transparent over exactly 300 ms; cost-meter total updates silently (no flash, no animation).
42. Under `prefers-reduced-motion: reduce`, the running-pill pulse is replaced by a static 2 px solid info-cyan border with no active `@keyframes` pulse; layout does not shift when the media query toggles. A vitest simulates the media query and asserts no active animations on the running pill.

### Accessibility

43. All interactive elements are keyboard-reachable via Tab; focus ring is 2 px solid info-cyan at 2 px offset and visible on every interactive background (verified per background, not only against page bg).
44. WCAG AA: text `#E5E7EB` on `#0B0F14` achieves ≥16:1 contrast; text-dim `#9CA3AF` on `#0B0F14` achieves ≥7.5:1; each accent text color on its 10 %-opacity composited fill is contrast-verified ≥4.5:1 via `wcag-contrast` and brightened if short.
45. The served page passes `axe-core` with zero violations at impact level `serious` or `critical` when rendered with `state.json` in each of four fixtures (pending, running, done, failed); the same audit passes `pa11y` with zero WCAG AA violations.
46. No modals or toasts are used for any state.

### Contrast helper

47. A new `src/ui/contrast.ts` module exports `brightenForContrast(accentHex: string, bgHex: string, targetRatio?: number): string` implementing the deterministic HSL-stepper algorithm: (1) composite the 10 %-opacity accent over `bgHex` to get the effective pixel color; (2) parse the accent to HSL; (3) iterate L upward in 2 % increments, re-measuring `wcag-contrast.hex(accent, effectiveFill)` on each step, until the score ≥ `targetRatio` (default 4.5); (4) cap L at 95–98 % — on loop cap, fall back to `--text #E5E7EB`.
48. All accent/fill adjustments are computed at build time from the palette in `constraints.md` and baked into the served CSS — never computed at page load.
49. A vitest asserts `brightenForContrast('#06B6D4', '#0B0F14')` returns an unchanged or near-unchanged value (cyan on the 10 %-opacity-cyan-over-`#0B0F14` fill already clears 4.5:1 (~7.5:1) — the loop is a fallback for future accent edits).

### Offline guarantee

50. Loading the dashboard with external network disabled produces only same-origin requests to the ridgeline local port; `<link rel="stylesheet">` and `<script>` tags reference no remote origins; no Google Fonts, Typekit, analytics, or telemetry snippets present.

### Tests

51. Dashboard smoke test starts the server, asserts `GET /` serves HTML, `GET /events` responds with the SSE headers, and `GET /state` returns JSON.
52. Snapshot or DOM-assertion coverage for empty, running, failed, and disconnected states (four fixtures).
53. Contrast-verification test loads each accent/fill pair and asserts ≥4.5:1 via `wcag-contrast`.
54. Reduced-motion test simulates the `prefers-reduced-motion: reduce` media query and asserts no active animations on the running pill.
55. Offline test loads the dashboard with outbound network blocked and asserts all requests are same-origin.
56. SSE replay test: connect, receive N events, disconnect, reconnect with `Last-Event-ID: <id>`, assert events with `id > last-event-id` are replayed before live streaming resumes.
57. File-watch test: append a line to a fixture `trajectory.jsonl`, assert exactly one `event: trajectory` is dispatched with the appended line as `data:` and that the watcher does not re-read prior lines (assertion on byte-offset tracker call boundaries).

### Check command

58. The check command from `constraints.md` (`npm run lint && npm test && npx tsc --noEmit`) exits 0 at the end of this phase.

## Spec Reference

Drawn from `spec.md`:

- **`ridgeline ui` localhost dashboard** (entire section)
- **Vitest coverage for new code paths** — item (h) plus the contrast / reduced-motion / offline tests

Drawn from `constraints.md`:

- Framework (Node built-in `http`; vanilla HTML/CSS/JS)
- API Style (three local endpoints; bound to `127.0.0.1`)
- Design Tokens (entire section: palette, typography, spacing, panel chrome, status pills, layout, motion, icons, tab identity, accessibility, terminal-format-related sections do not apply here)
- Offline Guarantee

Drawn from the Feature Design document:

- All sections (palette, typography, spacing, component chrome, layout, live updates, states, icons, page identity, accessibility, motion)

Drawn from `taste.md`:

- Visual Style (CSS custom properties on `:root`; vanilla JS no framework; inline SVGs; flat CSS; reduced-motion guards; lean compact; bias toward deletion)
- Test Patterns (assert absence; smoke-test the dashboard server; snapshot tests for served HTML/CSS; offline test; contrast verification test; reduced-motion test)
