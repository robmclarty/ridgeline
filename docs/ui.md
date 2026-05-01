# UI Dashboard

`ridgeline ui [build-name]` opens a localhost monitoring dashboard for an
active or completed build. It serves a fully offline dark-mode page from
`127.0.0.1` (default port `4411`) that live-updates over Server-Sent
Events, with a 2-second polling fallback on disconnect.

The dashboard is read-only. It surfaces what's already on disk
(`state.json`, `budget.json`, `trajectory.jsonl`) plus a stream of
real-time trajectory events while a build is running.

## Quick Start

```sh
# Most-recent build (auto-selected from .ridgeline/builds/*)
ridgeline ui

# Specific build
ridgeline ui my-feature

# Custom port
ridgeline ui my-feature --port 5050
```

The command prints the URL on startup and continues running until
`Ctrl+C`:

```text
Ridgeline UI listening at http://127.0.0.1:4411
  attached to: my-feature
```

## What the Dashboard Shows

```text
┌──────────────────────────────────────────────────────────┐
│ my-feature                              RUNNING          │
├──────────────────────────────────────────────────────────┤
│  shape         done                                       │
│  design        done                                       │
│  spec          done                                       │
│  plan          done                                       │
│ ▸ 01-scaffold  in progress    $1.42   2m 14s             │
│  02-core       pending                                    │
│  03-auth       pending                                    │
├──────────────────────────────────────────────────────────┤
│ Cost so far: $4.82                                        │
│ Last event:  build_complete (01-scaffold)                │
└──────────────────────────────────────────────────────────┘
```

- Pipeline stage row for each completed pre-build stage.
- One row per phase with status, cost, and elapsed time.
- A header pill (`RUNNING`, `DONE`, `FAILED`).
- A cost meter that updates silently as new budget entries arrive.
- The most recent trajectory event in monospace.

When no build name is given, the dashboard attaches to the directory
with the most recent `state.json` mtime under `.ridgeline/builds/*`.

## States

| State | Header | Visual |
|-------|--------|--------|
| **No build attached** | (none) | Centered panel: "No build attached. Run `ridgeline <name> "intent"` in another terminal, then reload." |
| **Running** | `RUNNING` | Info-cyan pulse on the active phase row (static border under `prefers-reduced-motion: reduce`) |
| **Done** | `DONE` | All phase rows green |
| **Failed** | `FAILED` | The failing phase row gains a 1px error-red border; the last trajectory error renders inline in monospace |
| **Disconnected** | -- | Sticky warning-amber banner at top: "Disconnected from ridgeline process. Retrying…". Auto-recovers silently on reconnect. |

## Offline Guarantee

The dashboard makes **zero outbound requests**. Once the page loads,
disabling the network does not degrade it:

- **System fonts only.** `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
  for body; `ui-monospace, 'SF Mono', Menlo, Consolas, monospace` for
  code. No `@font-face`, no CDN webfonts.
- **Inline SVG favicon** (`data:image/svg+xml,...`) whose fill reflects
  the current build status.
- **Inline CSS + inline vanilla JS.** No bundler, no framework, no
  external script tags.
- **All assets served from the local ridgeline process.**

This matters for two reasons:

1. The dashboard works inside sandboxes that block all outbound network
   traffic (greywall, bwrap with no-net).
2. There is no analytics, no telemetry, no third-party content. The
   dashboard cannot exfiltrate anything because it cannot reach anything.

## Transport

Two endpoints, both returning the same `DashboardSnapshot` schema:

- **`GET /events`** — Server-Sent Events stream. The dashboard subscribes
  on load. Heartbeats every 20 seconds.
- **`GET /state`** — One-shot snapshot. The dashboard polls this every
  2 seconds when the SSE stream is disconnected.

The fallback is automatic and silent. When the server restarts (e.g.,
you re-ran `ridgeline ui` after editing files), the dashboard reconnects
within ~2 seconds and the disconnect banner fades out.

## Accessibility

- Every accent/fill pair is contrast-verified ≥4.5:1 at stylesheet
  render time via `wcag-contrast`.
- WCAG AA minimum for all text (4.5:1 normal, 3:1 large); the baseline
  palette clears AAA (text on background ≥15:1).
- 2px focus ring with 2px offset on every interactive element.
- `prefers-reduced-motion: reduce` honored — the running-pill pulse, row
  update flash, and disconnect banner fade are all disabled.

## Port Binding and Fallback

The dashboard binds to `127.0.0.1` only — never `0.0.0.0`, never an
external interface. It will not be reachable from another machine.

Default port is `4411`. On `EADDRINUSE`, the server tries the next 30
ports (`4412`, `4413`, ...) before giving up. The actual bound port is
printed on startup; override with `--port <n>` to skip the fallback
search.

## Pairing with `ridgeline build`

The typical workflow for monitoring a long build:

```sh
# Terminal 1
ridgeline build my-feature

# Terminal 2
ridgeline ui my-feature
```

Or auto-select the most recent build (useful if you frequently switch
builds in Terminal 1):

```sh
# Terminal 2
ridgeline ui
```

The dashboard updates in real time as the build progresses. When the
build finishes, the header switches to `DONE` (or `FAILED`), and the
dashboard keeps serving so you can inspect the final state. Press
`Ctrl+C` in the dashboard terminal when done.

## What the Dashboard Does Not Do

- **No write actions.** It cannot start, stop, or modify a build. Use
  the CLI for that.
- **No log streaming.** Builder/reviewer output goes to its own terminal
  and to `log.jsonl`. The dashboard surfaces structured trajectory
  events, not raw stdout.
- **No remote access.** Bound to `127.0.0.1` only. Use SSH port
  forwarding (`ssh -L 4411:127.0.0.1:4411 host`) if you need to view a
  remote build's dashboard.

## CLI Reference

### `ridgeline ui [build-name]`

| Flag | Default | Description |
|------|---------|-------------|
| `--port <number>` | `4411` | Port to bind (falls back through 30 ports on `EADDRINUSE`) |

The `build-name` argument is optional; when omitted, the dashboard
attaches to the most-recently-modified build under `.ridgeline/builds/*`.

## Related Docs

- [Preflight, Detection, and Sensors](preflight-and-sensors.md) — the
  dashboard section there covers the rendering pipeline in more depth.
- [Build Lifecycle](build-lifecycle.md) — what the dashboard's stage and
  phase rows correspond to in the build flow.
