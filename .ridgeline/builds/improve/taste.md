# Taste

## Code Style

- Simplicity over abstraction. When a feature, flag, pack, or flavour could go either way, remove it.
- Expose full capability sets on module interfaces even when current callers only need a subset (keep stop/pause/resume, not just stop).
- Fold universal features into defaults, not flags. One knob (`--thorough`) over many.
- Always-on over opt-in where possible; surface inferred defaults via preflight rather than adding flags.
- Prefer pure functions and plain records over classes for new modules (`detect`, `sensors`, `preflight`).
- Early return over nested conditionals.
- User-facing error messages are actionable and name the removed/renamed thing explicitly, e.g. `Flavour "novel-writing" removed in 0.8.0. Non-software flavours are no longer supported; remove the --flavour flag to use the default software flavour.`
- No silent fallbacks for removed functionality — error clearly and point to the replacement.
- Fail-open on parse errors for structured verdicts: always synthesize on malformed output rather than silently skip.
- Sensor failures are non-fatal warnings; the builder continues blind rather than aborting a phase.
- Simple plain-data types over class hierarchies. TypeScript `interface` and `type` for data; minimal object composition for behavior.

## Visual Style

- Define all design tokens as CSS custom properties in a single `:root` block and reference them by name everywhere; never repeat hex values inline.
- Keep the dashboard client as vanilla JS with no framework or bundler step; target modern browsers only.
- Inline SVGs directly in the HTML template; never fetch them at runtime.
- Route every terminal color through a single semantic-color helper; never emit raw ANSI codes from feature modules.
- Keep CSS flat — no nesting frameworks, no BEM gymnastics. Short class names tied to semantic roles (`.pill-running`, `.row-flash`, `.disconnect-banner`).
- Put animations behind `@media (prefers-reduced-motion: reduce)` guards in the same stylesheet block where they are defined.
- Lean compact: smaller padding (4–8 px inside pills, 8–12 px inside panel rows) over generous whitespace.
- Prefer `text-dim` for labels, hints, and metadata; reserve full text color for primary content.
- Prefer tabular figures for aligned numeric columns (the mono stack provides this naturally).
- Prefer dim styling in terminal output for context the user already has (file paths they typed, repeated values); reserve full color for new information.
- Aim for AAA (7:1) contrast where it costs nothing, but do not compromise the compact dark aesthetic to chase AAA on edge cases — AA is the bar that must hold.
- Bias toward deletion when a visual element could go either way — smaller surface area is the goal.

## Test Patterns

- Vitest unit tests colocated in `src/**/__tests__/` next to the module under test; integration / e2e under the top-level `test/` tree.
- Extend the existing suite; never rewrite it.
- Stub subprocess and HTTP dependencies; never hit the real Claude CLI or real network in tests.
- Mock the Claude subprocess only at the boundary (`claude.exec.ts`); let higher-level modules run real logic.
- Prefer fixture directories for detection tests (`test/fixtures/react-vite-project/`, etc.) over ad-hoc object literals.
- Use real file I/O against temp dirs for store-related tests, matching existing convention.
- Snapshot tests for ANSI-enabled terminal output (preflight TTY vs non-TTY) and for served HTML/CSS.
- Parameterised tests for symmetric cases — all eight removed-flavour names in one test body.
- Assert **absence**, not only presence, where behavior is "no animation", "no network", "no box-drawing characters", "no raw ANSI codes", "no external requests".
- Contrast verification test loads each accent/fill pair and asserts ≥4.5:1 via `wcag-contrast`.
- Reduced-motion test simulates the `prefers-reduced-motion: reduce` media query and asserts no active animations.
- Offline test loads the dashboard with outbound network blocked and asserts all requests are same-origin.
- Smoke-test the dashboard server (starts, serves HTML, SSE endpoint responds, state snapshot returns JSON); no headless browser tests.
- Deterministic tests — no reliance on wall-clock timing beyond generous timeouts.

## Commit Format

Conventional Commits matching the existing CHANGELOG style:

- `feat(<scope>): ...`
- `fix(<scope>): ...`
- `chore: ...`
- `refactor(<scope>): ...`

Scope is the top-level area by module name: `flavours`, `sensors`, `detect`, `preflight`, `ensemble`, `ui`, `dashboard`, `cli`, `planner`, `config`, `agents`.

## Comment Style

- Default to no comments.
- Single-line comments only, and only where the WHY is non-obvious: a hidden constraint, a subtle invariant, a workaround for a specific bug.
- Never explain WHAT the code does — well-named identifiers carry that.
- Never reference the current task, fix, or callers in comments ("used by X", "added for Y", "handles the case from issue #123"). That context belongs in the PR description.
- No multi-paragraph docstrings. No JSDoc unless a type genuinely needs it.
- Do not comment visual rules that `constraints.md` already documents.
