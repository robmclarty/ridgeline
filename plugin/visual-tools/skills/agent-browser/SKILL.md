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
