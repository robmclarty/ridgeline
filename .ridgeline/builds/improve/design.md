# Design System — ridgeline 0.8.0

This document defines the visual language for two surfaces introduced or touched by the 0.8.0 build: the new `ridgeline ui` web dashboard (localhost-only, opt-in) and the existing terminal UI (preflight summary, spinner, logger, output, prompt, summary, transcript). The two surfaces share a unified semantic-color vocabulary so the tool feels coherent regardless of where the user is watching from.

Hard tokens use imperative language ("must", "always", "required"). Soft guidance uses directional language ("prefer", "lean toward"). The pipeline treats these differently at review.

---

## Scope and platform

- The dashboard is **dark-mode only** for v0.8.0. No light mode, no toggle. Strict surface-area cap.
- The dashboard is **desktop-first**: primary target ≥1024px viewport. Narrow viewports must render the phase list and cost meter stacked vertically without horizontal scroll, but no mobile polish (no touch-target minimums, no hamburger menu).
- The dashboard must work **fully offline on localhost**: zero webfont loads, zero CDN dependencies, zero analytics. All assets ship inline or from the local process.
- Max content width: **1280px**, centered on wider viewports.

---

## Colors

### Dashboard palette (hard tokens — must use these exact hex values)

| Token | Hex | Use |
|---|---|---|
| `bg` | `#0B0F14` | Page background |
| `panel` | `#121821` | Panel / card background |
| `border` | `#1F2937` | Panel and pill borders, 1px |
| `text` | `#E5E7EB` | Primary text |
| `text-dim` | `#9CA3AF` | Secondary / metadata text |

### Semantic accents (hard tokens — shared across dashboard and terminal)

| Token | Hex | Meaning |
|---|---|---|
| `error` | `#EF4444` | Failure, red in terminal |
| `success` | `#10B981` | Done, green in terminal |
| `warning` | `#F59E0B` | Caution, yellow in terminal |
| `info` | `#06B6D4` | Running, active, cyan/blue in terminal |

Semantic accent fills on dark backgrounds use the accent color at **10% opacity** for the fill and the full accent color (or a brightened variant) for the text on top. Verify each combination hits ≥4.5:1 contrast; bump text brightness if not.

### Rules

- No gradients anywhere.
- No pure black (`#000`) backgrounds — `#0B0F14` is the floor.
- The terminal UI must use the four semantic accents for their named meanings (error = red, success = green, warning = amber/yellow, info = cyan). Do not use semantic colors for decorative purposes.
- Prefer the `text-dim` token for any label, hint, or metadata text. Reserve full `text` color for primary content.

---

## Typography

### Font stacks (hard tokens — must use these stacks, no webfonts)

```text
Sans (chrome, labels, body):
  -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif

Mono (phase IDs, costs, timestamps, raw output):
  ui-monospace, 'SF Mono', Menlo, Consolas, monospace
```

### Scale (hard tokens)

`12 / 13 / 14 / 16 / 20` px. Intentionally compact. Do not introduce sizes outside this scale without justification.

### Usage

- Phase IDs, dollar amounts, elapsed times, and any value lifted from a file → **monospace**.
- Headings, labels, body copy, status pill text → **sans**.
- Build name (the prominent page heading) → 20px sans, full `text` color.
- Status pill text → 11px uppercase sans with letter-spacing (tracked).
- Body text → 14px sans.
- Labels and hints → 12–13px sans, `text-dim`.

Prefer tabular figures for any aligned numeric column (cost breakdown table); use the mono stack which gives this naturally.

---

## Spacing

### Base unit (hard token)

**4px**. Always use multiples of 4 for padding, margin, and gap. Common steps: 4 / 8 / 12 / 16 / 24 / 32 / 48.

### Density

This is a monitoring surface — **compact**. Lean toward smaller padding values (4–8px inside pills, 8–12px inside panel rows) over generous whitespace. Whitespace exists to separate semantic groupings, not to create breathing room.

---

## Component chrome

### Panels and cards (hard tokens)

- Border radius: **4px**
- Border: **1px solid `#1F2937`** (the `border` token)
- Background: **`#121821`** (the `panel` token)
- No drop shadows. Flat.

### Status pills (hard tokens — phase list and header)

- Padding: **4px vertical, 8px horizontal**
- Border radius: **4px**
- Text: **11px uppercase, tracked**
- Color map:
  - `pending` → `#9CA3AF` text on `#1F2937` fill
  - `running` → info cyan text on info-cyan-10%-opacity fill, with **opacity pulse 0.6 → 1.0 over 1.5s ease-in-out**
  - `done` → success green text on success-green-10%-opacity fill
  - `failed` → error red text on error-red-10%-opacity fill
  - `skipped` → `#9CA3AF` text on `#1F2937` fill (visually identical to pending — context disambiguates)

### Reduced motion (hard rule)

When `prefers-reduced-motion: reduce` is set, the running pill must not pulse. Replace the pulse with a static **2px solid info-cyan border** instead.

---

## Layout (dashboard)

Single scrolling pane. Top to bottom (hard order):

1. **Header** (sticky on scroll): build name (20px sans), elapsed time (14px mono), status pill, lowercase `ridgeline` wordmark (14px sans, `text-dim`) for orientation.
2. **Cost meter**: headline total `$X.XX` prominently (20px mono), per-stage breakdown table beneath (spec, plan, research, build, review columns).
3. **Phase list**: stacked rows. Each row shows phase ID (mono), slug (sans), status pill, elapsed time (mono).

No sidebar. No tabs. Split layout deferred past 0.8.0.

---

## Live updates

- Transport: **Server-Sent Events (SSE)** from the local ridgeline process. Fallback to **2s polling** if SSE drops.
- Visual feedback on data change: **300ms background flash on the updated row, info-cyan at 15% opacity, fading to transparent**. No slide-in animations on the dense phase list.
- The cost meter total updates **silently** — no flash, no animation. Too small to animate meaningfully.
- Disconnection state: sticky banner at top of page in warning amber, "Disconnected from ridgeline process. Retrying…" with a spinning info-cyan dot. Auto-recovers silently on reconnect (banner fades out over 400ms).

---

## States

### No build attached (empty state)

Centered panel with `text-dim` body reading:

```text
No build attached. Run `ridgeline <name> "intent"` in another terminal, then reload.
```

Show the dashboard port URL beneath.

### Build failed catastrophically

- Header status pill flips to error red `FAILED`.
- The failing phase row gets a **1px error-red border** (overrides the default panel border for that row).
- Last trajectory error message renders inline under that row in monospace, full text color.
- No modals, no toasts.

### Disconnection

See "Live updates" above.

---

## Icons

- **Inline SVG only.** No icon font, no runtime icon library.
- Use icons only where text alone would be unclear: copy-to-clipboard on phase IDs, external-link on file paths that open in the editor, expand/collapse chevron if the cost breakdown becomes collapsible.
- Visual reference: **Lucide** shapes — copied inline, not imported.
- Size: **16px**, stroke width **1.5**, color `currentColor` (inherits surrounding text color).
- **No icons on status badges.** The pill text is the badge.

---

## Page identity

### Tab title (hard format)

```text
● ridgeline · <build-name> · <status>
```

The leading `●` is generated as part of an inline-SVG favicon (16×16 filled circle, no detail) whose color reflects current status:

- Running → info cyan `#06B6D4`
- Done → success green `#10B981`
- Failed → error red `#EF4444`

The favicon is a single SVG data-URI, swapped on state change.

### Header wordmark

`ridgeline` — lowercase, 14px sans, `text-dim`. Treat as a text mark, not a logo. Do not bold, do not uppercase, do not add a glyph.

---

## Accessibility

### Required (hard rules)

- **WCAG AA minimum** for all text: 4.5:1 normal, 3:1 large.
- The base palette already clears AAA: `#E5E7EB` on `#0B0F14` ≈ 16:1; `#9CA3AF` on `#0B0F14` ≈ 7.5:1.
- All semantic-accent text colors on their 10%-opacity fills must be **verified ≥4.5:1**. If any combination falls short, brighten the text color until it passes.
- All interactive elements must be keyboard-reachable with a **visible focus ring: 2px solid info cyan, 2px offset**.
- Honor `prefers-reduced-motion` (see component chrome).

### Preferred

Aim for AAA (7:1) where it costs nothing. The compact dark aesthetic should not be compromised to chase AAA on edge cases — AA is the bar that must hold.

The dashboard ships alongside a pa11y/axe-core sensor that ridgeline uses to audit user projects. The dashboard itself must pass that same audit.

---

## Terminal UI conventions

### Preflight summary block (hard format)

Color-highlighted labels, **no box-drawing borders** (boxes look dated and waste vertical space). Format pattern:

```text
Detected   react, vite, design.md   →   enabling   Playwright, vision, pa11y, contrast

Ensemble   2 specialists   (use --thorough for 3)
Caching    on
```

- Labels (`Detected`, `Ensemble`, `Caching`, `enabling`) → **bold**, full text color.
- Values → dim (`text-dim` equivalent in terminal).
- Arrow `→` → **dim cyan** (info color, dimmed).
- Blank line separates the detection block from the configuration block.

### Prompt line (TTY)

```text
  Press Enter to continue, Ctrl+C to abort
```

Indented 2 spaces, dim text, on its own line.

### Non-TTY / CI

Same content as TTY, but **no prompt line**. Append a trailing `(auto-proceeding in CI)` note in dim text.

### Semantic colors

Terminal output must use the same four semantic accents as the dashboard, mapped to the standard ANSI roles:

- `error` → red
- `success` → green
- `warning` → yellow / amber
- `info` → cyan
- Secondary / hint text → dim gray

Prefer dim styling for any context the user already has (file paths the user just typed, repeated values). Reserve full color for new information.

---

## Motion

- **Running-pill pulse**: opacity 0.6 → 1.0 over 1.5s ease-in-out, infinite. Disabled under `prefers-reduced-motion`.
- **Row flash on update**: 300ms background flash, info-cyan at 15% opacity, fading to transparent.
- **Disconnect-banner fade-out on reconnect**: 400ms.
- No other motion. No slide-ins, no scale transforms, no parallax.

---

## What this document does not cover

- Game-visual and print-layout categories were matched but do not apply — ridgeline is a CLI tool with one local-port dashboard.
- Light mode, theming, user-customizable palettes — out of scope for 0.8.0.
- Detailed component library (buttons, inputs, modals) — the dashboard has none of these. Add to this document if and when they appear.
- Marketing or documentation site styling — out of scope.
