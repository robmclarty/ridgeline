# Phase 1: Foundations — flavour removal, detection, preflight, semantic colors, package metadata

## Goal

Establish the 0.8.0 baseline by deleting the flavour concept in full, shipping the detection-driven preflight that gates every token-spending command, consolidating terminal color through a single semantic helper, and updating package metadata (version, engines, new dependencies) so all downstream phases consume a clean foundation.

This is the load-bearing phase: every later phase reads a flavour-free `src/agents/`, calls into the new `DetectionReport`, formats output through `src/ui/color.ts`, and assumes the new dependencies are declared. It also delivers the most visible 0.8.0 changes — a stakeholder running any pipeline command sees the three-line preflight summary before tokens are spent and is told clearly that `--flavour` has been removed if they try to pass it.

When the phase completes: `src/flavours/` is gone; `--flavour` errors with the exact migration hint on every pipeline-entry command; `state.json` no longer carries a `flavour` field; `package.json` reads version `0.8.0` with `engines.node: ">=20.0.0"`, `playwright` declared as an optional `peerDependency`, and `axe-core` + `wcag-contrast` as direct dependencies; `runPreflight` renders the three-line summary in the exact format and gates pipeline commands behind Enter in TTY mode (auto-proceeding in CI); every terminal UI module routes color through one semantic helper with `NO_COLOR` and non-TTY respect.

## Context

This is phase 1. The repo currently has `src/flavours/` (15 directories), `src/agents/` (the canonical agent set with `core`, `planners`, `researchers`, `specialists`, `specifiers`), `src/engine/discovery/flavour.{resolve,config}.ts`, and a `--flavour` flag registered on every pipeline-entry command. The six terminal UI modules (`src/ui/{spinner,logger,output,prompt,summary,transcript}.ts`) emit raw ANSI codes today; there is no shared color helper yet. `package.json` has no `engines` field and no preflight surface exists.

`agent.registry.ts` currently resolves prompts via `src/flavours/<flavour>/<role>.md` with `src/agents/` as a fallback path; this phase reverses that — `src/agents/` becomes the only source.

This phase intentionally does NOT touch the `--thorough` / `--deep-ensemble` story (phase 3), the sensors (phase 2), the dashboard (phase 4), or the prompt-assembly rewrite (phase 3). It does add the `wcag-contrast` and `axe-core` dependencies and the `playwright` peer dep so phase 2 can wire them up without re-touching `package.json`.

## Acceptance Criteria

### Flavour removal

1. Directory `src/flavours/` does not exist after the change (verified by `fs.existsSync` returning false in a vitest).
2. `src/agents/core/` retains `builder.md`, `planner.md`, `researcher.md`, `specifier.md`, `reviewer.md`, `refiner.md`, `shaper.md`, `designer.md`, `retrospective.md` unchanged from baseline.
3. `src/agents/{planners,researchers,specialists,specifiers}/` remain in place as the canonical specialist tree.
4. `src/engine/discovery/flavour.resolve.ts`, `src/engine/discovery/flavour.config.ts`, and any `flavour.json` are deleted; `agent.registry.ts` resolves agent prompts directly from `src/agents/` with no flavour-dir intermediary or fallback.
5. Running any of `shape`, `design`, `spec`, `research`, `refine`, `plan`, `build`, `rewind`, `retrospective`, `create` with `--flavour <anything>` exits non-zero, with stderr containing the literal substrings `"removed in 0.8.0"` and `"drop the --flavour flag"`. The error message names the supplied flavour and points to the replacement.
6. The `--flavour` option is not registered on any command (verified by `ridgeline --help` output containing zero occurrences of `flavour` / `flavor` / `--flavour`, case-insensitive).
7. Running `ridgeline <cmd> 'intent'` with no `--flavour` flag resolves the canonical agent set and writes no `flavour` key to `state.json`. The `state.json` schema no longer declares a `flavour` field.
8. Ripgrep across `src/` returns no matches for the identifiers `Flavour`, `flavour`, `Flavor`, or `flavor` outside the literal deprecation-error string constants.
9. Ripgrep across `src/` returns zero matches for `CapabilityPack` or `capability-pack` (no capability-pack abstraction is introduced).
10. `package.json` `build` script no longer copies `src/flavours/` into `dist/` (the `rm -rf dist/flavours && cp -r src/flavours dist/flavours` segment is deleted).
11. `ridgeline check` does not warn about missing flavours or packs.
12. `fallow` passes on the surviving tree (no dangling imports or dead exports from deleted flavour modules).
13. `agnix` passes on the agent prompts under `src/agents/`.
14. A single parameterised vitest covers the `--flavour` removal error across all ten pipeline-entry commands listed above.
15. Every test file that imported from `src/flavours/` or exercised flavour-resolution paths is deleted; equivalent tests against `src/agents/` or `agent.registry.ts` replace them where coverage is lost.

### Project-signal auto-detection

16. `src/engine/detect/index.ts` exports `async function detect(cwd: string): Promise<DetectionReport>`.
17. `DetectionReport` is an exported TypeScript interface with exactly the fields: `projectType: 'web' | 'node' | 'unknown'`, `isVisualSurface: boolean`, `detectedDeps: string[]`, `hasDesignMd: boolean`, `hasAssetDir: boolean`, `suggestedSensors: Array<'playwright' | 'vision' | 'a11y' | 'contrast'>`, `suggestedEnsembleSize: 2 | 3`.
18. Detection sets `isVisualSurface: true` when `package.json` `dependencies` or `devDependencies` include any of: `react`, `vue`, `svelte`, `solid-js`, `vite`, `next`, `three`, `phaser`, `pixi.js`, `@babylonjs/core`, `electron`, `react-native`, `expo`.
19. Detection sets `isVisualSurface: true` when the working directory contains at least one file matching `**/*.html`, `**/*.tsx`, `**/*.jsx`, `**/*.vue`, or `**/*.svelte` (excluding `node_modules`, `.git`, `.worktrees`, `dist`, `build`).
20. Detection sets `hasDesignMd: true` iff `.ridgeline/design.md` exists at the project root.
21. When `isVisualSurface` is false and no visual-only deps are found, `suggestedSensors` is an empty array.
22. `suggestedEnsembleSize` is `2` unless `--thorough` is passed (the detection function accepts the flag value as an argument), in which case it is `3`.
23. Missing `package.json` is handled without throwing — `projectType` defaults to `'unknown'`, `isVisualSurface` is `false`.
24. Malformed `package.json` warns (not fatal) and falls back to filesystem-only signals.
25. A pure-backend project (express in deps, no html/css/tsx, no design.md) produces `isVisualSurface: false` with empty `suggestedSensors`.
26. A React+Vite project with `design.md` produces `isVisualSurface: true` with `suggestedSensors` equal to `['playwright', 'vision', 'a11y', 'contrast']` (any order).
27. A project with a `.jsx` file but no visual deps still flags `isVisualSurface: true`.
28. Detection completes in under 1 second on a fixture project of ≤100 files (asserted by vitest timing).
29. Running detection twice on an unchanged project produces byte-identical serialized reports (deterministic key ordering).
30. Fixture-based vitests cover at least five projects: React+Vite with `design.md`, pure Node, pure HTML, Vue+Vite, monorepo root-only.

### Preflight summary and TTY gate

31. `src/ui/preflight.ts` exports `async function runPreflight(report: DetectionReport, opts: { yes: boolean, isTTY: boolean }): Promise<void>`.
32. Rendered output contains three lines in this order: `Detected  <csv>  →  enabling  <csv>`, `Ensemble  <N> specialists  (use --thorough for 3)`, `Caching   on`.
33. Labels `Detected`, `Ensemble`, `Caching`, and `enabling` render bold in full text color; values render dim; the `→` arrow renders in dim cyan (ANSI 36 with dim attribute).
34. A single blank line separates the detection block from the Ensemble/Caching block.
35. Output contains none of the Unicode box-drawing characters `─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼` (verified by regex).
36. When `opts.isTTY === true` and `opts.yes === false`, the function resolves only after a newline is read from stdin (asserted by a vitest that sends no input and expects a pending promise after 200 ms).
37. TTY prompt line reads `Press Enter to continue, Ctrl+C to abort` indented exactly 2 spaces in dim text on its own line.
38. When `opts.isTTY === false`, output ends with the literal substring `(auto-proceeding in CI)` in dim text, and the function resolves without waiting on stdin.
39. When `opts.yes === true` in TTY mode, the function resolves without waiting on stdin and does not print the `(auto-proceeding in CI)` suffix.
40. Ctrl+C during preflight exits cleanly with non-zero status and no partial state is written to `.ridgeline/`.
41. Preflight runs before any ensemble or builder invocation for the ten pipeline-entry commands listed in criterion 5 — verified by a vitest that stubs the model subprocess and asserts preflight stdout appears before the first model-call log line.
42. Preflight is NOT triggered for `ridgeline ui`, `ridgeline check`, `ridgeline clean`, `ridgeline dry-run`, or `ridgeline catalog`.
43. When detection is ambiguous (e.g. a single `index.html` with no framework), preflight picks the narrower interpretation silently and continues; no interactive disambiguation prompt ships in 0.8.0.
44. Snapshot tests cover TTY, `--yes`, and non-TTY renderings.

### Terminal semantic colors

45. A single new module (e.g. `src/ui/color.ts`) is the only place raw ANSI escape sequences are emitted; ripgrep of `src/ui/{spinner,logger,output,prompt,summary,transcript}.ts` returns zero matches for raw ANSI escape codes (`\x1b[` or literal escape).
46. The helper exports semantic roles: `error` → ANSI red (31 / bright 91), `success` → green (32 / 92), `warning` → yellow (33 / 93), `info` / running → cyan (36 / 96), `hint` / dim context → dim gray (code 2 with default color).
47. Each of the six named terminal UI modules imports from the helper and uses semantic roles only; a grep check rejects cyan emit on a non-info/running code path.
48. When `NO_COLOR` env var is set or the stream is not a TTY, colors are stripped but content is byte-identical to the colored output (verified by vitest).
49. Preflight (criteria 31–44) uses the same helper for all bold / dim / dim-cyan formatting; no raw escape codes appear in `src/ui/preflight.ts`.

### Package metadata

50. `package.json` `version` reads exactly `0.8.0`.
51. `package.json` gains `"engines": { "node": ">=20.0.0" }` (the field is currently absent).
52. `package.json` declares `playwright` under `peerDependencies` with version range `">=1.57.0 <2.0.0"` and `peerDependenciesMeta: { "playwright": { "optional": true } }`.
53. `package.json` declares `axe-core` and `wcag-contrast` under `dependencies`.
54. No other new runtime dependencies are added in this phase.

### Documentation

55. `docs/` references to flavours, `--flavour`, and named flavour types (`data-analysis`, `game-dev`, `legal-drafting`, `machine-learning`, `mobile-app`, `music-composition`, `novel-writing`, `screenwriting`, `security-audit`, `software-engineering`, `technical-writing`, `test-suite`, `translation`, `web-game`, `web-ui`) are removed or rewritten to reference the detection flow.
56. Content under `plans/` is untouched (verified by git diff showing zero changes in `plans/**`).

### Check command

57. The check command from `constraints.md` (`npm run lint && npm test && npx tsc --noEmit`) exits 0 at the end of this phase.

## Spec Reference

Drawn from `spec.md`:

- **Flavour concept removal** (entire section)
- **Project-signal auto-detection** (entire section)
- **Preflight detection summary and TTY gate** (entire section)
- **Terminal semantic colors** (entire section)
- **Version bump and branch cutover** — `package.json` version + engines + peer dep + direct deps only; CHANGELOG and final cutover are deferred to phase 5
- **Vitest coverage for new code paths** — items (a), (b), (c) of the criteria block, plus the deletion of flavour-importing tests

Drawn from `constraints.md`:

- Language and Runtime (Node 20+, `engines.node`)
- Dependencies (peer dep + new direct deps)
- Terminal Preflight Summary Format
- Terminal Semantic Colors
