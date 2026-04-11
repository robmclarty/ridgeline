---
name: lighthouse
description: Run Lighthouse audits for performance, accessibility, and best practices scoring. Use when checking page performance, running quality audits, measuring Core Web Vitals, or getting a quantitative quality score for a web page.
compatibility: Requires Lighthouse CLI (npm i -g lighthouse)
metadata:
  author: ridgeline
  version: "1.0"
---

# Lighthouse Audit

Run Google Lighthouse for quantitative quality scores across performance, accessibility, and best practices.

## Running an audit

```bash
npx lighthouse <url> --output json --output-path ./lighthouse-report.json --only-categories=performance,accessibility,best-practices --chrome-flags="--headless=new --no-sandbox"
```

For a quick text summary:

```bash
npx lighthouse <url> --output html --output-path ./lighthouse-report.html --only-categories=performance,accessibility,best-practices --chrome-flags="--headless=new --no-sandbox"
```

## Reading results

Parse the JSON output to extract category scores:

```bash
node -e "
const r = require('./lighthouse-report.json');
const cats = r.categories;
console.log('Performance:', Math.round(cats.performance.score * 100));
console.log('Accessibility:', Math.round(cats.accessibility.score * 100));
console.log('Best Practices:', Math.round(cats['best-practices'].score * 100));
"
```

## Score thresholds

- **Performance > 90**: Good
- **Performance 50–90**: Needs improvement
- **Performance < 50**: Poor
- **Accessibility > 90**: Good (aim for 100)
- **Accessibility < 90**: Needs attention

## Severity mapping

- Accessibility score < 90 when design.md requires WCAG → blocking
- Performance or best practices concerns → suggestion
- All scores are informational by default — context determines severity

## Gotchas

- Lighthouse scores vary between runs (±5 points). Run 3 times and take the median for reliable results.
- Local dev servers often score low on performance due to unminified assets. This is expected.
- Lighthouse requires a running page — start the dev server first.
