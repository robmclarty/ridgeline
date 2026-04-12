---
name: canvas-screenshot
description: Capture rendered canvas and WebGL frames from browser-based games and visual applications. Use when verifying canvas rendering, checking WebGL output, capturing game screenshots, or validating visual output from PixiJS, Phaser, Three.js, or raw canvas apps.
compatibility: Requires agent-browser CLI (npm i -g agent-browser) or Playwright (npm i -g playwright)
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
