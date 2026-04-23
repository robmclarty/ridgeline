# Phase 1a: Flavour removal, agent-registry rewire, package metadata, test pruning

## Goal

Ship the irreversible disk changes of 0.8.0 in a single self-contained phase: delete `src/flavours/`, rewire `agent.registry.ts` to resolve prompts exclusively from `src/agents/`, update `package.json` (version, engines, peer dep, direct deps), and prune tests that imported from the deleted tree. When the phase completes the repo is flavour-free, lintable, testable, and installable — a clean foundation for the additive modules that land in phase 1b (detection, preflight, color helper).

The phase is ordered deliberately: the registry rewire lands **before** the `src/flavours/` deletion, so there is a known-good flavour-free resolution path proven by tests before the fallback source is removed. A git checkpoint separates the rewire from the deletion so rewind is a single `git reset`. Package metadata edits are followed by a full install-and-check gate before test pruning begins.

A coverage floor guards against silent loss: the total vitest count at phase end must equal or exceed the baseline minus the count of deleted flavour-importing test files plus the count of new tests this phase requires. Deletion-only reductions are forbidden.

This phase does NOT touch the `--thorough` / `--deep-ensemble` story (phase 3a), the sensors (phase 2), the dashboard (phase 4), the prompt-assembly rewrite (phase 3b), the detection module (phase 1b), preflight (phase 1b), or the semantic color helper (phase 1b).

## Context

This is phase 1a of the 0.8.0 build. The repo currently has `src/flavours/` (15 directories), `src/agents/` (the canonical agent set with `core`, `planners`, `researchers`, `specialists`, `specifiers`), `src/engine/discovery/flavour.{resolve,config}.ts`, and a `--flavour` flag registered on every pipeline-entry command. `agent.registry.ts` currently resolves prompts via `src/flavours/<flavour>/<role>.md` with `src/agents/` as a fallback path.

`package.json` currently has no `engines` field, no peer dependencies, and carries version `0.7.19`. The `build` script copies `src/flavours/` into `dist/flavours/` via `rm -rf dist/flavours && cp -r src/flavours dist/flavours`.

Tests that reference `src/flavours/` or exercise flavour-resolution exist under `test/` and `src/**/__tests__/` — counts to be captured at baseline.

## Acceptance Criteria

### Ordered flow — the sequence is load-bearing

1. **Baseline capture.** Before any code edits, record and persist two counts to `phase-1a-baseline.json` in the phase worktree: (a) total passing vitest count from `npm test` on an unmodified working tree; (b) count of test files whose contents match ripgrep pattern `'src/flavours/|flavour\.resolve|flavour\.config'` under `test/` and `src/**/__tests__/`. These numbers drive the coverage-floor check in criterion 19.
2. **Registry rewire lands first.** `src/engine/discovery/agent.registry.ts` is edited to resolve agent prompts exclusively from `src/agents/` — the `src/flavours/<flavour>/<role>.md` lookup path is removed, and so is the fallback. `src/flavours/` still exists on disk at this step.
3. **Pre-deletion resolution check.** A vitest is added that iterates every pipeline-entry command (`shape`, `design`, `spec`, `research`, `refine`, `plan`, `build`, `rewind`, `retrospective`, `create`) and calls the registry to resolve its full agent set. The test passes with zero missing roles while `src/flavours/` is still on disk. This is the green light for deletion.
4. **Git checkpoint.** The rewire + resolution test are committed as a single commit before any deletion begins. The commit message is `refactor(agents): route agent.registry.ts through src/agents/ only` (or equivalent). The phase worktree's HEAD after this commit is recorded in `phase-1a-checkpoint.txt` so rewind is mechanical.
5. **Flavour deletion.** `src/flavours/` is deleted (`git rm -r`). `src/engine/discovery/flavour.resolve.ts`, `src/engine/discovery/flavour.config.ts`, and any `flavour.json` are deleted.
6. **Post-deletion check.** `npm run lint && npm test && npx tsc --noEmit` exits 0. The resolution test from criterion 3 still passes. `fallow` reports no dangling imports or dead exports pointing at the deleted modules.
7. **Package.json edit lands next.** `package.json` is updated in a single commit: version → `0.8.0`; `engines.node` → `">=20.0.0"`; `peerDependencies.playwright` → `">=1.57.0 <2.0.0"`; `peerDependenciesMeta.playwright.optional` → `true`; `dependencies.axe-core` and `dependencies.wcag-contrast` added; the `build` script's `rm -rf dist/flavours && cp -r src/flavours dist/flavours` segment is deleted.
8. **Install-and-check gate.** After the package.json edit, `npm install && npm run lint && npm test && npx tsc --noEmit` exits 0 **before** any other criterion in this phase is attempted. A fresh `node_modules` is allowed; the check failing here is a hard stop for the phase.
9. **Test pruning lands last.** Every test file that imports from `src/flavours/`, imports from `flavour.resolve.ts` / `flavour.config.ts`, or exercises flavour-resolution paths is deleted in a single commit. No other test files are deleted. Replacement tests are added where coverage shifts to `src/agents/` or `agent.registry.ts`.

### Flavour removal — post-condition criteria

10. Directory `src/flavours/` does not exist after the change (verified by `fs.existsSync` returning false in a vitest).
11. `src/agents/core/` retains `builder.md`, `planner.md`, `researcher.md`, `specifier.md`, `reviewer.md`, `refiner.md`, `shaper.md`, `designer.md`, `retrospective.md` unchanged from baseline.
12. `src/agents/{planners,researchers,specialists,specifiers}/` remain in place as the canonical specialist tree.
13. Running any of `shape`, `design`, `spec`, `research`, `refine`, `plan`, `build`, `rewind`, `retrospective`, `create` with `--flavour <anything>` exits non-zero, with stderr containing the literal substrings `"removed in 0.8.0"` and `"drop the --flavour flag"`. The error message names the supplied flavour and points to the replacement.
14. The `--flavour` option is not registered on any command (verified by `ridgeline --help` output containing zero occurrences of `flavour` / `flavor` / `--flavour`, case-insensitive).
15. Running `ridgeline <cmd> 'intent'` with no `--flavour` flag resolves the canonical agent set and writes no `flavour` key to `state.json`. The `state.json` schema no longer declares a `flavour` field.
16. Ripgrep across `src/` returns no matches for the identifiers `Flavour`, `flavour`, `Flavor`, or `flavor` outside the literal deprecation-error string constants.
17. Ripgrep across `src/` returns zero matches for `CapabilityPack` or `capability-pack`.
18. A single parameterised vitest covers the `--flavour` removal error across all ten pipeline-entry commands listed in criterion 13.

### Test pruning — coverage floor

19. **Coverage floor.** The phase-end `npm test` summary reports a passing test count `N_end` satisfying `N_end >= N_baseline - D + A`, where `N_baseline` is captured in criterion 1, `D` is the count of deleted flavour-importing test files (also from criterion 1), and `A` is the count of new test files added by this phase (criteria 3 and 18 plus any replacement tests). The arithmetic is asserted in a CI-executable script, not a manual inspection.
20. The set of deleted test files in this phase's git diff is a **subset** of the set matching ripgrep `'src/flavours/|flavour\.resolve|flavour\.config'` on the phase-start tree. Any test file deleted outside that set fails the phase.
21. `fallow` passes on the surviving tree.
22. `agnix` passes on the agent prompts under `src/agents/`.

### Package metadata — post-condition

23. `package.json` `version` reads exactly `0.8.0`.
24. `package.json` contains `"engines": { "node": ">=20.0.0" }`.
25. `package.json` declares `playwright` under `peerDependencies` with range `">=1.57.0 <2.0.0"` and `peerDependenciesMeta: { "playwright": { "optional": true } }`.
26. `package.json` declares `axe-core` and `wcag-contrast` under `dependencies`.
27. `package.json` `build` script contains no reference to `src/flavours/` or `dist/flavours/`.
28. `ridgeline check` does not warn about missing flavours or packs.

### Documentation

29. `docs/` references to flavours, `--flavour`, and named flavour types (`data-analysis`, `game-dev`, `legal-drafting`, `machine-learning`, `mobile-app`, `music-composition`, `novel-writing`, `screenwriting`, `security-audit`, `software-engineering`, `technical-writing`, `test-suite`, `translation`, `web-game`, `web-ui`) are removed or rewritten. Criteria covering new-flag docs (`--thorough`, `--yes`, `--port`, preflight format) are deferred to phase 1b and phase 5.
30. Content under `plans/` is untouched (verified by git diff showing zero changes in `plans/**`).

### Check command

31. The check command from `constraints.md` (`npm run lint && npm test && npx tsc --noEmit`) exits 0 at the end of this phase.

## Spec Reference

Drawn from `spec.md`:

- **Flavour concept removal** (entire section)
- **Version bump and branch cutover** — `package.json` version + engines + peer dep + direct deps only; CHANGELOG and final cutover are deferred to phase 5
- **Vitest coverage for new code paths** — item (a) (parameterised `--flavour` removal error) and the deletion of flavour-importing tests

Drawn from `constraints.md`:

- Language and Runtime (Node 20+, `engines.node`)
- Dependencies (peer dep + new direct deps)
