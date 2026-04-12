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

```text
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
