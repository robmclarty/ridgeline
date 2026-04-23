---
depends_on: [01a-flavour-removal-and-metadata]
---
# Phase 1b: Project-signal detection, preflight TTY gate, semantic color helper

## Goal

Add the three additive modules that complete the 0.8.0 foundation on top of the flavour-free, 0.8.0-versioned base phase 1a delivers: `src/engine/detect/` (project-signal scanner producing `DetectionReport`), `src/ui/preflight.ts` (TTY-gated detection summary rendered before any token-spending command), and `src/ui/color.ts` (single semantic-color helper that the six existing terminal UI modules now route through).

When the phase completes: `detect(cwd)` returns a deterministic `DetectionReport` with the exact field set spec requires; `runPreflight` renders the three-line summary in exact format and gates pipeline-entry commands behind Enter in TTY mode (auto-proceeding in CI, skipping on `--yes`, and never firing for inspection commands); every terminal UI module routes color through the single helper, `NO_COLOR` strips colors while preserving content, and no raw ANSI escape appears in any feature module.

This phase is purely additive — no files are deleted. If phase 1b fails mid-run, phase 1a's clean foundation is still intact, and rewind is a single `git reset` to the 1a tip.

## Context

Phase 1a deleted `src/flavours/`, rewired `agent.registry.ts` to resolve prompts exclusively from `src/agents/`, updated `package.json` to 0.8.0 with `engines.node: ">=20.0.0"`, declared `playwright` as an optional peer dep, added `axe-core` and `wcag-contrast` as direct dependencies, and pruned tests that imported from the deleted flavour tree. `fallow`, `agnix`, `npm run lint`, `npm test`, and `npx tsc --noEmit` all pass on the phase 1a tip.

The six terminal UI modules (`src/ui/{spinner,logger,output,prompt,summary,transcript}.ts`) currently emit raw ANSI codes inline. There is no shared color helper yet. `src/engine/detect/` does not exist. `src/ui/preflight.ts` does not exist. No preflight is wired into the pipeline-entry commands.

Phase 2 will consume `DetectionReport.suggestedSensors` and extend preflight with the Playwright install-hint; this phase establishes the surface those hooks attach to.

## Acceptance Criteria

### Project-signal auto-detection

1. `src/engine/detect/index.ts` exports `async function detect(cwd: string): Promise<DetectionReport>`.
2. `DetectionReport` is an exported TypeScript interface with exactly the fields: `projectType: 'web' | 'node' | 'unknown'`, `isVisualSurface: boolean`, `detectedDeps: string[]`, `hasDesignMd: boolean`, `hasAssetDir: boolean`, `suggestedSensors: Array<'playwright' | 'vision' | 'a11y' | 'contrast'>`, `suggestedEnsembleSize: 2 | 3`.
3. Detection sets `isVisualSurface: true` when `package.json` `dependencies` or `devDependencies` include any of: `react`, `vue`, `svelte`, `solid-js`, `vite`, `next`, `three`, `phaser`, `pixi.js`, `@babylonjs/core`, `electron`, `react-native`, `expo`.
4. Detection sets `isVisualSurface: true` when the working directory contains at least one file matching `**/*.html`, `**/*.tsx`, `**/*.jsx`, `**/*.vue`, or `**/*.svelte` (excluding `node_modules`, `.git`, `.worktrees`, `dist`, `build`).
5. Detection sets `hasDesignMd: true` iff `.ridgeline/design.md` exists at the project root.
6. When `isVisualSurface` is false and no visual-only deps are found, `suggestedSensors` is an empty array.
7. `suggestedEnsembleSize` is `2` unless `--thorough` is passed (the detection function accepts the flag value as an argument), in which case it is `3`.
8. Missing `package.json` is handled without throwing — `projectType` defaults to `'unknown'`, `isVisualSurface` is `false`.
9. Malformed `package.json` warns (not fatal) and falls back to filesystem-only signals.
10. A pure-backend project (express in deps, no html/css/tsx, no design.md) produces `isVisualSurface: false` with empty `suggestedSensors`.
11. A React+Vite project with `design.md` produces `isVisualSurface: true` with `suggestedSensors` equal to `['playwright', 'vision', 'a11y', 'contrast']` (any order).
12. A project with a `.jsx` file but no visual deps still flags `isVisualSurface: true`.
13. Detection completes in under 1 second on a fixture project of ≤100 files (asserted by vitest timing).
14. Running detection twice on an unchanged project produces byte-identical serialized reports (deterministic key ordering).
15. Fixture-based vitests cover at least five projects: React+Vite with `design.md`, pure Node, pure HTML, Vue+Vite, monorepo root-only.

### Preflight summary and TTY gate

16. `src/ui/preflight.ts` exports `async function runPreflight(report: DetectionReport, opts: { yes: boolean, isTTY: boolean }): Promise<void>`.
17. Rendered output contains three lines in this order: `Detected  <csv>  →  enabling  <csv>`, `Ensemble  <N> specialists  (use --thorough for 3)`, `Caching   on`.
18. Labels `Detected`, `Ensemble`, `Caching`, and `enabling` render bold in full text color; values render dim; the `→` arrow renders in dim cyan (ANSI 36 with dim attribute).
19. A single blank line separates the detection block from the Ensemble/Caching block.
20. Output contains none of the Unicode box-drawing characters `─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼` (verified by regex).
21. When `opts.isTTY === true` and `opts.yes === false`, the function resolves only after a newline is read from stdin (asserted by a vitest that sends no input and expects a pending promise after 200 ms).
22. TTY prompt line reads `Press Enter to continue, Ctrl+C to abort` indented exactly 2 spaces in dim text on its own line.
23. When `opts.isTTY === false`, output ends with the literal substring `(auto-proceeding in CI)` in dim text, and the function resolves without waiting on stdin.
24. When `opts.yes === true` in TTY mode, the function resolves without waiting on stdin and does not print the `(auto-proceeding in CI)` suffix.
25. Ctrl+C during preflight exits cleanly with non-zero status and no partial state is written to `.ridgeline/`.
26. Preflight runs before any ensemble or builder invocation for the ten pipeline-entry commands (`shape`, `design`, `spec`, `research`, `refine`, `plan`, `build`, `rewind`, `retrospective`, `create`) — verified by a vitest that stubs the model subprocess and asserts preflight stdout appears before the first model-call log line.
27. Preflight is NOT triggered for `ridgeline ui`, `ridgeline check`, `ridgeline clean`, `ridgeline dry-run`, or `ridgeline catalog`.
28. When detection is ambiguous (e.g. a single `index.html` with no framework), preflight picks the narrower interpretation silently and continues; no interactive disambiguation prompt ships in 0.8.0.
29. Snapshot tests cover TTY, `--yes`, and non-TTY renderings.

### Terminal semantic colors

30. A single new module (e.g. `src/ui/color.ts`) is the only place raw ANSI escape sequences are emitted; ripgrep of `src/ui/{spinner,logger,output,prompt,summary,transcript}.ts` returns zero matches for raw ANSI escape codes (`\x1b[` or literal escape).
31. The helper exports semantic roles: `error` → ANSI red (31 / bright 91), `success` → green (32 / 92), `warning` → yellow (33 / 93), `info` / running → cyan (36 / 96), `hint` / dim context → dim gray (code 2 with default color).
32. Each of the six named terminal UI modules imports from the helper and uses semantic roles only; a grep check rejects cyan emit on a non-info/running code path.
33. When `NO_COLOR` env var is set or the stream is not a TTY, colors are stripped but content is byte-identical to the colored output (verified by vitest).
34. Preflight (criteria 16–29) uses the same helper for all bold / dim / dim-cyan formatting; no raw escape codes appear in `src/ui/preflight.ts`.

### Check command

35. The check command from `constraints.md` (`npm run lint && npm test && npx tsc --noEmit`) exits 0 at the end of this phase.

## Spec Reference

Drawn from `spec.md`:

- **Project-signal auto-detection** (entire section)
- **Preflight detection summary and TTY gate** (entire section — except the Playwright install-hint clause, deferred to phase 2)
- **Terminal semantic colors** (entire section)
- **Vitest coverage for new code paths** — items (b) and (c)

Drawn from `constraints.md`:

- Terminal Preflight Summary Format
- Terminal Semantic Colors
