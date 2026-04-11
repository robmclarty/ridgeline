---
name: css-audit
description: Analyze CSS for design system drift, specificity issues, and bloat using Project Wallace. Use when reviewing CSS quality, checking for unused rules, auditing color and font consistency, or detecting specificity problems in stylesheets.
compatibility: Requires Project Wallace CSS Analyzer (npm i -g @projectwallace/css-analyzer)
metadata:
  author: ridgeline
  version: "1.0"
---

# CSS Audit

Analyze CSS statistics to detect design system drift, specificity issues, and bloat.

## Running an audit

```bash
npx @projectwallace/css-analyzer ./path/to/styles.css
```

For multiple files, concatenate first:

```bash
cat src/**/*.css | npx @projectwallace/css-analyzer --stdin
```

## What to check

### Color consistency
Look at unique color count. A design system should have 8–15 unique colors. More than 20 signals drift — values like `#333` vs `#343434` vs `rgb(51,51,51)` that should be a single token.

### Font size consistency
Check unique font-size count. More than 8–10 unique sizes suggests missing a type scale. Look for near-duplicates like `14px` and `0.875rem` (same value, different units).

### Specificity issues
High max specificity (above `0,3,0`) risks cascade conflicts. Check the specificity distribution — heavy clustering above `0,2,0` means selectors are fighting each other.

### Selector complexity
Average selector length above 3 suggests over-qualified selectors. Look for selectors like `.header .nav .list .item a` that should be simplified.

## Severity mapping

- **> 25 unique colors**: Suggestion — likely design system drift
- **Max specificity > 0,4,0**: Suggestion — cascade risk
- **> 15 unique font sizes**: Suggestion — missing type scale
- **Average selector length > 4**: Suggestion — over-qualified selectors
