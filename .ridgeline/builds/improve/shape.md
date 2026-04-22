# improve

## Intent

Ship a v0.8.0 iteration of ridgeline on a new branch (replacing main on completion) that eliminates three pains the sole user hits when using ridgeline to build downstream node/TS apps for web/games/mobile: flavour-system complexity that makes "forgot a flag → wasted build" a real failure mode, a builder agent that is blind to visual output on projects with a visual surface, and ensemble orchestration that burns 12+ Claude calls before a single phase builds. The goal is simplicity over abstraction: fewer flavours, fewer flags, fewer packs, more always-on sensors, smarter defaults, and a preflight step that shows what ridgeline inferred before any money is spent.

## Scope

Size: large

Boundaries:

**In scope:**

- Collapse src/flavours/ to a single 'software' flavour; delete novel-writing, screenwriting, legal-drafting, music-composition, translation, data-analysis, machine-learning, security-audit (8 dirs)
- Remove the capability-pack abstraction entirely; ship Playwright, Claude vision, pa11y/axe-core, and contrast/WCAG checks as always-available builder tools in the software core
- Playwright shipped as a peerDependency; auto-prompt install at preflight when a visual-surface project is detected
- Project-signal auto-detection at startup (package.json deps like react/vite/three/phaser, design.md presence, file types .html/.css/.tsx, .ridgeline/ contents)
- Preflight step that prints 'Detected: X → enabling Y' and blocks on Enter unless --yes or non-TTY; in CI, prints and proceeds
- Default ensembles (spec, plan, research) to 2 specialists (down from 3)
- New --thorough flag that bumps specialists to 3 and enables two-round cross-specialist annotation consistently across ensembles; deprecate --deep-ensemble
- Structured-output specialist verdicts with diff-based agreement detection; when specialists agree, skip synthesizer write and emit a one-line audit note in the phase artifact
- Prompt caching of unchanged stage inputs (spec.md, constraints.md, taste.md) across invocations
- New `ridgeline ui` command that attaches a local-port dashboard to a live or completed build (phase graph + cost meter), opt-in and separate from core runs
- `--flavour <removed-name>` errors immediately with a clear redirect message (no silent fallback)
- Builder prompt instructs 'if the project has a visual surface, self-verify with Playwright + vision + pa11y + contrast'; sensor failures warn and continue blind
- Version bump to 0.8.0 from the new branch when ready; branch replaces main on cutover
- Extend existing vitest suite for new code paths (sensor invocation, preflight detection, ensemble reduction, removed-flavour errors, --thorough wiring)

**Out of scope:**

- Mastra migration, block library extraction, monorepo split
- Base+overlay composable-layer flavour refactor (replaced by aggressive collapse)
- Multi-model abstraction / lifting the Claude CLI subprocess dependency
- Visual pipeline or node-graph editor for wiring agents
- Tldraw/canvas workspaces for design stages
- Migration scripts for 0.7.x .ridgeline/builds/* artifacts (clean break; old builds stay on 0.7.x)
- Keeping removed flavours in a legacy/ directory or as dormant config
- Restoring or extending non-software domains (novel-writing, screenwriting, legal, music, translation, data-analysis, ML, security-audit)
- Game-specific, mobile-specific, or audio-specific sensors beyond the four named (Playwright, vision, pa11y, contrast)
- Touching catalog-related dependencies (sharp, colorthief, free-tex-packer-core) or catalog behavior
- Replacing the linter stack (oxlint, markdownlint, agnix, fallow)
- Rewriting the existing test suite
- Changing sandboxing providers or the git/worktree/checkpoint model
- Acting on any content in plans/ (mastra-redesign, project1-block-library, project2-ridgeline-monorepo, refactor-composable-layers) — explicitly ignored
- Introducing telemetry, external reporting, or cloud state
- Backwards-compatibility shims for 0.7.x flag names beyond the --deep-ensemble → --thorough migration

## Solution Shape

A breaking-but-streamlined 0.8.0 release. Developed on a new branch, cut over to main when ready. Preserves the durable infrastructure (git tag checkpoints, Greywall/bwrap sandboxing, worktree isolation, atomic state/budget/trajectory stores, linter stack, vitest suite) and rewrites only what obstructs the three goals.

Primary workflow:

1. User runs `ridgeline my-build 'intent text'` (no --flavour). Ridgeline scans package.json, .ridgeline/, and project files to detect project signals.
2. Preflight prints a detection summary — e.g. 'Detected: react + vite + design.md → enabling Playwright, vision, pa11y; ensemble: 2 specialists; prompt caching on'. User presses Enter (or auto-proceeds in CI / with --yes).
3. Pipeline runs shape → spec → plan → build → review. Spec and plan default to 2 specialists; structured verdicts enable synthesis skip when specialists agree (audit note logged). Prompt caching hits on unchanged constraints.md/spec.md across stages.
4. In build, the builder has Playwright, Claude vision, pa11y/axe-core, and contrast/WCAG checks always available. If a visual surface is detected, the builder self-verifies by screenshotting and evaluating. Playwright failures warn but don't abort the phase.
5. Separately, `ridgeline ui` attaches a local-port dashboard to any running or completed build for phase-graph and cost-meter viewing.
6. `--thorough` bumps specialist count and enables two-round cross-specialist annotation across all ensembles. `--deep-ensemble` is removed with a deprecation message.

Shape of the codebase change: flavour count drops from 15 to 1; a new src/engine/detect/ module owns project-signal detection; a new src/sensors/ module wraps Playwright/vision/pa11y/contrast as builder tool adapters; src/engine/pipeline/ensemble.exec.ts gains default-2/opt-in-3 logic plus structured-agreement synthesis skip; src/engine/claude/agent.prompt.ts reshapes prompt assembly for cache-boundary hits; src/cli.ts adds preflight step and --thorough flag; a new src/commands/ui.ts + src/ui/dashboard.* powers the dashboard. Removed-flavour-name errors live in flavour.resolve.ts.

## Risks & Complexities

- Project-signal auto-detection will mis-classify edge cases (vanilla JS project with a single index.html — 'web' or not?). Mitigation: preflight surfaces detection and user can veto or correct via shape.md; only ask when genuinely ambiguous.
- Playwright as peerDependency may confuse a first-time run — 'why is it prompting me to install a browser?'. Mitigation: preflight shows what was detected and why the install is requested, with a one-command install path.
- Structured-output agreement detection requires reshaping specialist prompts to emit a parseable skeleton. Malformed output must fall back to always-synthesize. Conservative diff threshold needed so real divergence is never hidden.
- Prompt caching effectiveness depends on exact prompt assembly order. May require refactoring agent.prompt.ts to put stable content (constraints.md, taste.md) before volatile content (per-phase handoff) to hit cache boundaries.
- `ridgeline ui` scope creep risk — must ship as a local-port dashboard only, not a full web app with auth, routing, or external state. Strict cap on surface area.
- Deleting 8 flavours means the sole surviving software flavour absorbs all non-overlay behavior. Overlays that only existed in deleted flavours (e.g., screenwriting-specific planner bullets) are gone for good — acceptable per user confirmation but worth explicit acknowledgment.
- Reviewer verdict schema may need to understand new sensor outputs (visual-diff results, a11y violations, contrast failures). Scope creep risk if the schema expansion grows — cap at a single 'sensorFindings' array in the existing verdict.
- Dev server coordination for Playwright — the builder needs to know when a dev server is running and on which port. Needs a simple convention (check common ports, or declare in shape.md), not a complex discovery protocol.
- Removing `--deep-ensemble` is a breaking CLI change. User is sole consumer and approved clean break, but any scripts or docs that reference it must be updated in the same change.
- Sandboxing compatibility with Playwright browser spawn — Greywall/bwrap may restrict the browser process. If incompatible, the sensor degrades gracefully (warn and continue blind) rather than the build aborting.
- 'Default 2 specialists' halves diversity of proposals. On genuinely novel builds this may produce weaker specs/plans. Mitigation: --thorough is the single escape hatch; document when to reach for it.
- Agreement-based synthesis skip could mask subtle conflicts that a synthesizer would have reconciled. Mitigation: diff must be on structured fields, not prose; any prose-level difference forces synthesis.
- The 0.8.0 branch must stay mergeable while developed — current main is actively iterating (0.7.19 just shipped). Long-lived branch divergence risk; keep the branch rebased frequently or cut over quickly once green.

## Existing Landscape

TypeScript 5.9 CLI, ~5,160 LOC in src/, single runtime dep on commander@13 (plus catalog-only sharp/colorthief/free-tex-packer-core). Layered structure: src/cli.ts (Commander entry) → src/commands/ (one file per pipeline stage: shape, design, spec, research, refine, plan, build, dry-run, catalog, check, clean, rewind, retrospective, create) → src/engine/{claude,discovery,pipeline} (subprocess/stream, flavour/agent discovery, ensemble + DAG phase orchestration) → src/stores/ (state.json, budget.json, trajectory.jsonl, handoff, phases, settings, feedback.parse/format/io, tags — all with atomic writes and file locks) → src/ui/ (terminal: spinner, logger, output, prompt, summary, transcript) → src/flavours/ (15 subdirs × ~23 agent md files = ~346 near-duplicate files) → src/agents/ (core/planners/researchers/specialists/specifiers prompt templates) → src/catalog/ (asset indexing, tangential to this build). Build pipeline runs inside a git worktree under .worktrees/; completed phases merge back. Greywall/bwrap sandbox adapters live in src/engine/claude/sandbox.*. Vitest unit + e2e tests. Linters: oxlint, markdownlint, agnix (agent prompts), fallow (dead-code). Current version 0.7.19. Recent CHANGELOG shows active tuning (model resolution from settings.json, planner phase sizing, transcript capture, sandbox env shim).

**External dependencies:**

- Claude CLI (subprocess substrate — preserved; auth via user's Claude subscription OAuth)
- commander@13 (CLI parsing — preserved)
- sharp@0.34, colorthief@3.3, free-tex-packer-core@0.3 (catalog-only — untouched)
- Greywall (macOS sandbox provider — preserved)
- bubblewrap/bwrap (Linux sandbox provider — preserved)
- Node.js (runtime — preserved)
- Git (checkpoints, worktrees — preserved)
- NEW: Playwright (peerDependency — visual sensor, auto-prompted at preflight when needed)
- NEW: axe-core or pa11y-core (a11y audits — direct dep, lightweight)
- NEW: a WCAG contrast utility (e.g. wcag-contrast — direct dep, lightweight)
- Dev tooling (unchanged): typescript@5.9, vitest@4.1, oxlint@1.58, markdownlint-cli2@0.21, agnix@0.17, fallow@2.13

**Data structures:**

- RidgelineConfig, ShapeDefinition, PipelineState, BuildState, PhaseGraph, BudgetEntry, AgentRegistry, SandboxProvider (preserved; may extend SandboxProvider to allow browser-process exceptions if needed)
- state.json / budget.json / trajectory.jsonl / handoff.md / spec.md / constraints.md / taste.md / research.md / shape.md / design.md / phases/NN-slug.md / phases/NN-slug.feedback.md (formats preserved; no migration)
- NEW: DetectionReport — output of the preflight scanner: { projectType, visualSurface, detectedDeps, designMdPresent, assetDirPresent, suggestedSensors, suggestedEnsembleSize }
- NEW: SpecialistVerdict skeleton — structured output emitted by each specialist alongside prose; fields are stage-specific (spec: sectionOutline + riskList; plan: phaseList + depGraph) and are what agreement detection diffs
- NEW: SensorFinding — unified record produced by visual sensors: { kind: 'screenshot'|'a11y'|'contrast'|'vision', path?, summary, severity } — fed into the reviewer's verdict as a sensorFindings array
- NEW: Preflight summary render data — minimal struct for the TTY display

**Relevant modules:**

- src/flavours/software-engineering/ — the sole surviving flavour; gets new sensor tool declarations and a rewritten builder overlay mentioning the visual self-verification pattern
- src/flavours/{novel-writing,screenwriting,legal-drafting,music-composition,translation,data-analysis,machine-learning,security-audit}/ — DELETED
- src/engine/discovery/flavour.resolve.ts + flavour.config.ts — simplifies drastically; adds removed-flavour error path
- src/engine/pipeline/ensemble.exec.ts — default-2 logic, structured-verdict collection, diff-based agreement detection, synthesis skip with audit note
- src/engine/pipeline/{specify,plan,research}.exec.ts — wire --thorough; drop --deep-ensemble
- src/engine/claude/agent.prompt.ts — prompt assembly reshaped for cache-boundary hits (stable content first)
- src/engine/claude/claude.exec.ts — may need flag for prompt caching; preserves subprocess lifecycle and kill handling
- src/cli.ts — adds preflight invocation before command handlers; adds --thorough; removes --deep-ensemble with a deprecation message; updates --flavour handling
- src/commands/build.ts — builder invocation gains sensor tool injection; no structural change to the phase loop
- NEW: src/engine/detect/ — project-signal scanner (package.json deps, file presence, .ridgeline/ contents) producing DetectionReport
- NEW: src/ui/preflight.ts — preflight summary renderer and blocking prompt (TTY) / pass-through (CI)
- NEW: src/sensors/ — Playwright driver, Claude-vision wrapper, a11y runner, contrast checker; each exports a tool adapter the builder invokes
- NEW: src/commands/ui.ts + src/ui/dashboard.* — `ridgeline ui` command and its local-port dashboard (phase graph + cost meter)
- src/stores/settings.ts — may gain a field for cached detection results; otherwise unchanged
- test/ and `src/**/__tests__/` — extended for new paths; not rewritten
- docs/ — updated to reflect the collapse and the new flags; plans/ untouched per user directive

## Technical Preferences

- **Error handling:** Visual sensor failures are non-fatal warnings — the builder continues blind ('an un-seen build is still a build'). `--flavour <removed-name>` errors immediately with a clear redirect message, never silently falls back. Preflight ambiguity prompts the user only when detection is genuinely ambiguous; otherwise picks the narrower option silently. In CI / non-TTY, preflight prints detection and proceeds without blocking. Ensemble quorum behavior preserved (if too many specialists fail, halt). Malformed structured-verdict output falls back to always-synthesize rather than skip. Playwright browser-spawn failure degrades the sensor, not the phase. Removed flags (--deep-ensemble) print a one-line deprecation and map to --thorough for the current run, then error cleanly in a future minor.
- **Performance:** Primary lever is ensemble-call reduction: default 2 specialists halves cost immediately across spec/plan/research without quality-detection machinery. Secondary lever is prompt caching of stable stage inputs (constraints.md, taste.md, spec.md) across invocations; achieved by ordering prompt assembly to put stable content first. Tertiary lever is agreement-based synthesis skip when structured verdicts are near-identical; strictly opt-in via structured-output diff (not prose diff), with an audit note preserved. No specific cost-reduction percentage is a hard requirement — measurable reduction on a reference software build is the outcome, not the constraint. Do not add caching complexity that isn't a direct win on real runs.
- **Security:** Sandboxing (Greywall on macOS, bwrap on Linux) preserved unchanged — visual sensors run inside the sandbox or degrade gracefully if incompatible. Playwright browser process must be constrained to localhost / the dev server port; no general network access granted. pa11y and axe-core run locally against the project's own rendered output; no external reporting. Claude vision sends screenshot content to Anthropic via the existing Claude CLI path (same trust boundary as all other agent calls). No telemetry, no third-party analytics, no cloud state. Settings.json remains the sole project-local configuration surface; no new secrets required. User's Claude subscription OAuth (not API key) remains the auth model.
- **Trade-offs:** Simplicity over abstraction — explicit and repeatedly confirmed by the user. Always-on tools over opt-in packs. One knob (--thorough) over many (--deep-ensemble and cousins). Fewer flavours (1 vs 15) over DRY-via-overlays. Clean break on behavior over migration compatibility (sole user; 0.7.x builds stay on 0.7.x). Preserve what works (git checkpoints, sandboxing, worktree isolation, state stores, linters, test suite) and rewrite only what obstructs the goals. Bias toward deletion — when a feature could go either way, remove it. Breaking CLI changes are acceptable at the 0.8.0 boundary; silent behavior changes are not (preflight surfaces them).
- **Style:** TypeScript strict, existing conventions preserved. File/module layout follows the established src/{cli,commands,engine,stores,ui,flavours,agents,catalog,utils} pattern; new modules (detect, sensors, ui dashboard) slot in without relocating existing ones. Boolean naming uses is/has/should prefixes (per user preference: isVisualSurface, hasDesignMd, shouldRunPreflight). Linter stack unchanged — oxlint for code, markdownlint for docs, agnix for agent prompts, fallow for dead-code analysis. Vitest tests extended per new code path; not rewritten. Comments single-line by default and only where the WHY is non-obvious; no multi-paragraph docstrings. Error messages user-facing and actionable (e.g. 'Flavour "novel-writing" removed in 0.8.0. Non-software flavours are no longer supported; remove the --flavour flag to use the default software flavour.'). Pre/post-commit: `npm run lint` after each task per CLAUDE.md.
