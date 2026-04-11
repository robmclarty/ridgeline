---
name: a11y-audit
description: Run WCAG 2.1 AA accessibility checks using axe-core. Use when verifying accessibility compliance, checking contrast ratios, validating ARIA usage, auditing keyboard navigation, or reviewing landmark structure.
compatibility: Requires axe-core CLI (npm i -g @axe-core/cli)
metadata:
  author: ridgeline
  version: "1.0"
---

# Accessibility Audit

Run automated WCAG 2.1 AA compliance checks against a running web page.

## Running an audit

```bash
npx @axe-core/cli <url>
```

Example:

```bash
npx @axe-core/cli http://localhost:3000 --stdout
```

## Common checks

axe-core tests for:
- **Color contrast**: Text must meet WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text)
- **ARIA attributes**: Valid roles, required properties, correct state management
- **Keyboard navigation**: All interactive elements focusable, logical tab order
- **Landmark regions**: Content in appropriate landmarks (main, nav, footer)
- **Image alt text**: All images have appropriate alt attributes
- **Form labels**: All inputs have associated labels
- **Heading hierarchy**: Headings in logical order without skipping levels

## Interpreting results

axe categorizes violations by impact:
- **Critical**: Blocks access for some users entirely (e.g., missing form labels, keyboard traps)
- **Serious**: Significantly impairs usability (e.g., contrast failures, missing landmarks)
- **Moderate**: Creates difficulty but doesn't block access
- **Minor**: Best practice improvements

## Severity mapping

- Critical or serious violations → blocking
- Moderate or minor violations → suggestion

## Gotchas

- axe-core only catches ~30% of accessibility issues. Manual testing (keyboard navigation, screen reader) is still needed.
- Dynamic content (modals, dropdowns) must be in their open state to be tested.
- Single-page apps: test multiple routes, not just the landing page.
