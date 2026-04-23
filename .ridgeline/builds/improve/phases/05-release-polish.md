---
depends_on: [03b-prompt-caching, 04-dashboard]
---
# Phase 5: Release polish — CHANGELOG, docs, final test gap-fill, cutover readiness

## Goal

Close out 0.8.0. Author the `CHANGELOG.md` 0.8.0 entry with Added / Changed / Removed / Breaking subsections that explicitly enumerate every breaking change the earlier phases shipped. Rewrite any remaining `docs/` references to `--flavour`, named flavour types, or `--deep-ensemble` so they point at the detection-driven flow and the new `--thorough` / `--yes` / `--port` flags. Fill any remaining gaps in the test matrix called out in the spec's "Vitest coverage for new code paths" section. Run the full check command — `npm run lint && npm test && npx tsc --noEmit` — and confirm the 0.8.0 branch is ready for fast-forward or merge cutover to main.

This phase does NOT bump `package.json` (already done in phase 1a — version is `0.8.0`, `engines.node` is `>=20.0.0`, `playwright` is declared as an optional peer dep, `axe-core` and `wcag-contrast` are direct deps). It does NOT perform the actual git merge to main — the user drives that step.

A dedicated polish phase prevents two common release hazards: (1) docs/CHANGELOG drift accumulating across earlier phases that each focused on code; (2) cross-phase test regressions where one phase's deletion shadow-removed coverage another phase implicitly relied on. A fresh context running the full suite end-to-end catches both.

## Context

Phases 1a–4 have shipped the features:

- Phase 1a: flavour removal, `agent.registry.ts` rewire to `src/agents/` only, package metadata (version, engines, peer dep, direct deps), test pruning with coverage floor.
- Phase 1b: project-signal detection, preflight TTY gate, semantic color helper and six-file UI refactor.
- Phase 2: four sensor adapters, builder integration, shape.md `## Runtime` convention, preflight install hint.
- Phase 3: lean ensembles, structured verdicts, prompt caching, reviewer `sensorFindings` field.
- Phase 4: `ridgeline ui` localhost dashboard with SSE, contrast helper, a11y/offline tests.

`package.json` at this point already reads version `0.8.0` with `engines.node: ">=20.0.0"`, the `playwright` peer dep at `>=1.57.0 <2.0.0` with `optional: true`, and `axe-core` + `wcag-contrast` as direct dependencies. The build script no longer copies `src/flavours/`.

`CHANGELOG.md` does not yet have a `## 0.8.0` entry. `docs/` may still contain stale references that earlier phases removed only at the use site they touched, leaving cross-page inconsistencies.

## Acceptance Criteria

### CHANGELOG

1. `CHANGELOG.md` contains a new entry with heading `## 0.8.0` containing four subsections in this order: Added, Changed, Removed, Breaking.
2. Breaking section explicitly lists, at minimum:
   - Deletion of `src/flavours/` (all 15 directories) and the `--flavour` flag.
   - Removal of the `state.json` `flavour` field.
   - Removal of `--deep-ensemble` as a documented flag (mapped to `--thorough` with deprecation notice).
   - No migration for 0.7.x builds.
   - New `engines.node: ">=20.0.0"` floor.
   - Note that no capability-pack abstraction is introduced — tool selection is driven by detection.
3. Added section enumerates at minimum: always-on sensors (Playwright, Claude vision, axe-core, wcag-contrast); project-signal auto-detection (`DetectionReport`); preflight detection summary with TTY gate; default-2 specialist ensembles; `--thorough` with two-round cross-annotation; structured specialist verdicts with agreement-based synthesis skip; prompt caching of stable stage inputs; `ridgeline ui` localhost dashboard.
4. Changed section enumerates: the reviewer verdict's new `sensorFindings: SensorFinding[]` field; the prompt assembly order change (constraints → taste → spec via `--append-system-prompt-file`); the `shape.md` `## Runtime` section convention; semantic terminal color routing through a single helper.
5. Removed section enumerates: `src/flavours/`; `flavour.resolve.ts`, `flavour.config.ts`, `flavour.json`; the `--flavour` flag; the `state.json` `flavour` field; the `--deep-ensemble` documented flag.

### Documentation

6. `docs/` references to `--flavour`, the `--deep-ensemble` documented flag, and the named flavour types (`data-analysis`, `game-dev`, `legal-drafting`, `machine-learning`, `mobile-app`, `music-composition`, `novel-writing`, `screenwriting`, `security-audit`, `software-engineering`, `technical-writing`, `test-suite`, `translation`, `web-game`, `web-ui`) are updated or removed. Ripgrep over `docs/` returns zero matches for `--flavour`, `--deep-ensemble`, and each named-flavour identifier outside `CHANGELOG.md` and any explicitly historical sections.
7. `docs/` gains coverage (new or updated pages) for `--thorough`, `--yes`, `--port`, `ridgeline ui`, the preflight summary format, the `shape.md` `## Runtime` convention, the four sensors, structured verdicts, and prompt caching. Internal links between pages are consistent (no dangling references).
8. Content under `plans/` is untouched (verified by git diff showing zero changes in `plans/**`).

### Test matrix gap-fill

9. At least one vitest file exercises each of the following — failing-fast on any gap left by phases 1a–4:
   - (a) `--flavour` removal error parameterised across every pipeline-entry command (`shape`, `design`, `spec`, `research`, `refine`, `plan`, `build`, `rewind`, `retrospective`, `create`).
   - (b) `DetectionReport` field population for at least five fixture projects (React+Vite with `design.md`, pure Node, pure HTML, Vue+Vite, monorepo root-only).
   - (c) Preflight TTY block vs `--yes` vs non-TTY pass-through.
   - (d) Specialist call count of 2 without `--thorough` and 3 with.
   - (e) Structured-verdict agreement skip + audit, disagreement → synthesis, malformed → synthesis + warning.
   - (f) Each of the four sensor adapters with stubbed I/O.
   - (g) Prompt assembly order snapshot AND argv contains `--append-system-prompt-file` and `--exclude-dynamic-system-prompt-sections`.
   - (h) Dashboard server smoke test (starts, serves HTML, SSE endpoint responds, `/state` returns JSON).
10. Dashboard tests include snapshot or DOM-assertion coverage for empty, running, failed, and disconnected states.
11. Contrast-verification test loads each accent/fill pair and asserts ≥4.5:1 via `wcag-contrast`.
12. Reduced-motion test simulates the `prefers-reduced-motion: reduce` media query and asserts no active animations on the running pill.
13. Offline test loads the dashboard with outbound network blocked and asserts all requests are same-origin.
14. No test file remains that imports from `src/flavours/` or exercises flavour-resolution paths (verified by ripgrep across `src/**/__tests__/` and `test/`).

### Final cross-phase audit

15. Final ripgrep sweep across `src/`:
    - Zero matches for `Flavour`, `flavour`, `Flavor`, or `flavor` outside the literal deprecation-error string constants.
    - Zero matches for `CapabilityPack` or `capability-pack`.
    - Zero raw ANSI escape codes (`\x1b[` or literal escape) in feature modules outside `src/ui/color.ts`.
    - Zero `fs.watchFile` usage in `src/ui/dashboard/` or `src/commands/ui.ts`.
    - Zero `@font-face` declarations in served dashboard CSS.
    - Zero cross-origin asset references (no `https://`, no third-party domains) in served dashboard HTML/CSS.
16. `package.json` at branch tip still reads version `0.8.0`, `engines.node: ">=20.0.0"`, `playwright` peerDependency range `">=1.57.0 <2.0.0"` with `peerDependenciesMeta.playwright.optional: true`, and `axe-core` + `wcag-contrast` in `dependencies`. The build script contains no reference to `src/flavours/`.
17. Branch state is verified clean: no uncommitted changes, no stale `.ridgeline/` artifacts from test runs committed.

### Final green check

18. `npm run lint && npm test && npx tsc --noEmit` exits 0 at the end of this phase.
19. Test counts equal or exceed the cumulative count after phase 4; no skipped tests are introduced (verified by reading the vitest summary line).
20. The 0.8.0 branch is documented as ready for cutover to main via fast-forward or merge (not via force-push). The actual merge to main is NOT performed in this phase — the user drives the git cutover.

## Spec Reference

Drawn from `spec.md`:

- **Version bump and branch cutover** — only the CHANGELOG, docs, and final-check / cutover-readiness criteria; the version bump itself was completed in phase 1a.
- **Vitest coverage for new code paths** (entire section — this phase fills any remaining gaps from earlier phases and verifies the full matrix is present).

Drawn from `constraints.md`:

- Check Command (`npm run lint && npm test && npx tsc --noEmit`).

Drawn from `taste.md`:

- Commit Format (Conventional Commits matching existing CHANGELOG style for the entry).
- Test Patterns (extend, never rewrite the existing suite; assert absence where the behavior is "no X").
