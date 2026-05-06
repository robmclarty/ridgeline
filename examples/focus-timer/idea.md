# Focus Timer — Pomodoro SPA

A single-page web app for running focus / break cycles. The whole app lives in
one folder, ships as static files, and runs from `index.html` opened in a
browser or served by any static host. No backend, no build server in
production — just HTML, CSS, and a small TypeScript bundle.

This document is the authoritative source for the build. Use it as-is when
filling in `shape.md`, `spec.md`, `constraints.md`, `taste.md`, and
`design.md`. Where this document is silent, the synthesizer should infer
defaults and flag them under `## Inferred / Gaps`.

## Project Identity

- **Name:** Focus Timer
- **One-liner:** A keyboard-first Pomodoro timer with session history,
  ambient soundscapes, and a calm, monochrome interface.
- **Audience:** Solo knowledge workers who already use Pomodoro and want a
  single-purpose tool that does not nag them, gamify them, or require an
  account.
- **Non-audience:** Teams. Multi-device sync. Anything that needs auth.

## Scope

### In scope

- 25 / 5 / 15 default Pomodoro cycle (focus / short break / long break after
  every 4th focus block) with editable durations.
- Start / pause / reset controls. Skip-to-next-phase control.
- Visible countdown (mm:ss), current phase label, and a progress ring that
  drains as time elapses.
- Session history persisted to `localStorage`: a dated list of completed
  focus blocks with optional one-line tag/note per block.
- Ambient soundscape selector (off, brown noise, rain, café). Audio assets
  loop seamlessly. Single global volume slider with mute toggle.
- Browser notification + a soft chime when a phase ends. Both must be
  toggleable; both default off until the user grants permission.
- Keyboard shortcuts: `space` start/pause, `r` reset, `n` next phase,
  `m` mute, `?` open shortcuts overlay.
- Settings drawer for durations, sound, notifications, theme. Persists to
  `localStorage`. Export/import settings as JSON.
- Light, dark, and system-preference themes. Theme switch is instant.

### Out of scope

- User accounts, login, multi-device sync, server-side anything.
- Team features, leaderboards, streaks, gamification.
- Calendar / task-manager integrations.
- Mobile-native packaging (Capacitor, Tauri). The web app must be usable on
  mobile browsers but mobile-specific UX is not a goal.
- Analytics, telemetry, third-party trackers.

## User Flows (Golden Path)

1. User opens `index.html`. The timer loads in the **idle** state showing
   `25:00`, phase label *Focus*, and a full progress ring.
2. User presses `space`. Timer counts down by the second. The ring drains
   from 12 o'clock clockwise, easing slightly so the motion feels natural.
3. At 0, the chime plays (if enabled), the browser notification fires (if
   enabled and permitted), and the app auto-advances to *Short Break* with
   `5:00`. The ring resets and starts again. The completed focus block is
   appended to history.
4. After four focus blocks, the next break is *Long Break* with `15:00`.
5. User can press `n` at any time to skip the current phase, `r` to reset
   the current phase to its full duration, or `space` to pause.
6. User opens the settings drawer (gear icon, top right) to adjust
   durations or pick a soundscape. Changes apply on close.
7. User opens the history panel (clock icon) to see today's focus blocks
   and add one-line notes to past blocks.

## Acceptance Criteria (MUST-PASS)

The implementation must satisfy all of the following. The reviewer agent
will treat these as blocking.

- Timer ticks once per second with ≤100ms drift over a 25-minute block.
  Achieve this with a wall-clock (`performance.now()`) reconciliation, not
  by trusting `setInterval`.
- Pause/resume preserves the remaining time exactly — no rounding errors
  that lose or add seconds.
- Closing and reopening the tab mid-phase resumes from where the user left
  off, restoring phase, remaining time, and which focus block in the cycle.
- Keyboard shortcuts work from anywhere on the page except inside text
  inputs (notes field, settings inputs).
- Notifications never fire if the tab is foregrounded — fall back to chime
  only when the page is visible.
- All controls are reachable by `Tab` in a logical order. Visible focus
  ring on every interactive element. No keyboard trap inside the drawer or
  overlay.
- Color contrast ≥ WCAG AA in both light and dark themes for all body
  copy, button labels, and the timer digits.
- Page weight (HTML + CSS + JS + initial fonts, excluding audio) ≤ 100 KB
  gzipped. Audio assets lazy-load on first soundscape selection.
- Initial render to interactive ≤ 500 ms on a mid-tier laptop with cold
  cache.
- Works in current Chrome, Firefox, and Safari. No required polyfills for
  evergreen browsers.

## Technical Constraints

- **Language:** TypeScript, strict mode.
- **Stack:** Vite + vanilla TS + a tiny state store (no React/Vue/Svelte).
  CSS via PostCSS or hand-written; no Tailwind. The point is a small,
  legible bundle.
- **No runtime dependencies** beyond what Vite ships. No state libraries,
  no UI libraries. A single small audio loop helper is fine.
- **Persistence:** `localStorage` only, namespaced under a single key
  (`focus-timer/v1`). Schema-versioned so future migrations are possible.
- **Tests:** Vitest. Cover the timer reducer, the persistence layer (round-
  trip serialize/deserialize), and the keyboard handler (which keys do what
  in which states). DOM-rendered tests via Vitest's jsdom environment for
  the controls.
- **Check command:** `npm run typecheck && npm run lint && npm run test &&
  npm run build`. The build must produce a `dist/` that can be served by
  `npx serve dist` and behave identically to the dev server.
- **Lint:** Use the project's existing oxlint config (or fall back to a
  reasonable default). No `any`, no unused vars, no console statements in
  shipped code.
- **Accessibility:** Run `axe-core` against the rendered page in tests.
  Zero violations at the AA level.

## Design Direction

I want the visual identity to feel calm, considered, and slightly
analog — the way a well-made paper notebook feels — without leaning into
twee skeuomorphism. References, in order of importance:

1. **Linear app** — for the typographic discipline, restraint, and the
   way every pixel feels intentional.
2. **iA Writer** — for the monospace headings, generous whitespace, and
   single-task focus.
3. **Things 3** — for the way the interface stays out of the way when
   you're not interacting with it.

### Hard tokens

- **Type:** Inter for body, JetBrains Mono for the timer digits and any
  numeric data. Nothing else.
- **Type scale:** 14 / 16 / 20 / 32 / 96 (the 96 is the timer digits).
- **Palette (light):** background `#FAFAF8`, surface `#FFFFFF`, ink
  `#111111`, muted ink `#5C5C5A`, accent `#2F6F4E` (deep green, used
  sparingly for the active phase ring and primary CTA only). One warning
  red `#A33A2A` reserved for destructive confirmations.
- **Palette (dark):** background `#101010`, surface `#181818`, ink
  `#F2F2EE`, muted ink `#A0A09C`, accent `#7FB89A`, warning `#D77A6A`.
- **Radius:** 4 px on inputs, 8 px on cards, 999 px on the progress ring.
- **Shadow:** none on the surface. A single 1 px hairline border in muted
  ink for separation.
- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 40 / 64 px.
- **Motion:** 120 ms for state changes (button presses, drawer toggles),
  240 ms for the drawer slide, 1 s linear for the progress ring
  countdown. No bouncing, no parallax, no "wow" animation.

### Soft guidance

- The timer digits are the visual anchor of the page. Everything else
  recedes when the timer is running.
- Treat the progress ring as a single hairline; do not fill it.
- Idle state should feel still — no breathing animations on the digits or
  ring.
- Avoid icons-only buttons except for the gear and the clock; everywhere
  else, prefer a plain text label.
- The history panel is a chronological list, not a chart. No graphs.

## Risks & Things To Get Right

- Timer drift across long focus blocks. Use wall-clock reconciliation.
- Tab-throttling in background tabs (browsers throttle `setInterval` to
  ~1 Hz when the tab is hidden). Reconciliation handles this; do not rely
  on tick count.
- Notification permission UX — don't auto-prompt on first load. Only
  request when the user toggles notifications on.
- Audio autoplay policy — the chime needs a user gesture to "unlock".
  Prime the audio context on the first start press.
- Restoring mid-phase state on reload requires storing a phase start
  timestamp, not a remaining-time value, so a closed tab doesn't keep
  ticking forward in stored state.

## Project Layout (Suggestion)

```text
src/
├── main.ts              // entry, mounts app
├── app.ts               // top-level component / view orchestration
├── state/
│   ├── store.ts         // tiny pub-sub store
│   ├── timer.ts         // reducer for timer state machine
│   ├── settings.ts      // settings + persistence
│   └── history.ts       // history + persistence
├── ui/
│   ├── timer-view.ts
│   ├── controls.ts
│   ├── settings-drawer.ts
│   ├── history-panel.ts
│   └── shortcuts-overlay.ts
├── audio/
│   ├── chime.ts
│   └── soundscape.ts
├── styles/
│   ├── tokens.css       // CSS variables for both themes
│   └── app.css
└── tests/
    ├── timer.test.ts
    ├── persistence.test.ts
    └── keyboard.test.ts
```

This layout is a suggestion; the planner can deviate if there's a clear
reason, but each phase's output should still produce something demoable
(don't leave half-implemented features between phases).

## Phasing Hint

A reasonable decomposition (the planner will refine this):

1. **Scaffold** — Vite + TS project, lint/test/typecheck/build wired,
   empty `index.html` rendering "Focus Timer".
2. **Core timer** — state machine, controls, wall-clock reconciliation,
   keyboard shortcuts, full unit tests.
3. **Visual layer** — design tokens, both themes, timer view + progress
   ring, controls styling, axe-core passes AA.
4. **Persistence + history** — localStorage round-trip, history panel,
   settings drawer.
5. **Audio + notifications** — chime, soundscape selector, notification
   permission flow.
6. **Polish** — shortcuts overlay, settings export/import, final
   accessibility and contrast pass.

## Done Looks Like

- `npm run dev` opens a fully working timer.
- `npm run build` produces a `dist/` directory under 100 KB gzipped
  (excluding audio).
- `npm run check` (the project's check command) passes clean.
- A reviewer can use the app for a full Pomodoro cycle, restart the tab
  mid-phase, and have everything restore correctly.
- Visual review against the references above passes — restraint, type
  discipline, calm motion, AA contrast in both themes.
