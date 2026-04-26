# Changelog

## v0.8.4 — 2026-04-25

### Fixed

- Builder no longer crashes on Claude CLI 2.1.x with `Cannot use both
  --append-system-prompt and --append-system-prompt-file`. When prompt
  caching is enabled, the dynamic per-phase system prompt is now folded
  behind the stable prefix in the same temp file passed via
  `--append-system-prompt-file`; the upstream prompt cache continues to
  hit on the stable bytes. A runtime guard
  (`assertSystemPromptFlagsExclusive`) catches any future regression at
  the args-assembly site.

### Internal

- `/version` skill instructions aligned with the weft iteration;
  resolved an agnix lint error.

## v0.8.3 — 2026-04-25

### Fixed

- `ridgeline spec` and `ridgeline research` now honor the
  `specialistTimeoutSeconds` setting from `.ridgeline/settings.json`.
  Previously the override was silently ignored — only commands routed
  through `resolveConfig` (`plan`, `build`) read it, so users who set
  e.g. `600` to give research more headroom still hit the hard-coded
  3-minute default.
- Raised the built-in default specialist timeout from 180s to 600s.
  The previous default was too aggressive for non-trivial research and
  spec ensembles, causing premature failures on slower projects.

### Internal

- Excluded `.ridgeline/` build output from every lint tool (oxlint,
  markdownlint, agnix, fallow), including top-level markdown under
  `.ridgeline/`.

## 0.8.2

Tool selection is now driven by detection rather than a user-selected flavour
taxonomy. Ridgeline scans the project, proposes sensors and ensemble sizing,
surfaces the plan via a TTY-gated preflight, and runs the pipeline with the
smallest ensemble that can cover the work. A new localhost dashboard
(`ridgeline ui`) gives a live read on the running build without leaving the
terminal session idle.

### Added

- Always-on builder sensor pipeline (`src/sensors/`) — Playwright Chromium
  screenshots, Claude vision descriptions of those screenshots, `axe-core`
  WCAG-AA accessibility audit, and `wcag-contrast` design-token contrast
  scoring. Per-phase findings are persisted to
  `<buildDir>/sensors/<phaseId>.json` and threaded into the reviewer's verdict.
- Project-signal auto-detection (`src/engine/detect/`) exposes
  `detect(cwd, opts)` returning a `DetectionReport` with project type,
  detected deps, filesystem signals, `isVisualSurface`, `hasDesignMd`,
  `suggestedSensors`, and `suggestedEnsembleSize`. Fixture-tested across
  React+Vite, Vue+Vite, pure-Node, pure-HTML, and monorepo-root shapes.
- Preflight detection summary with TTY gate: the 10 pipeline-entry commands
  render a `Detected … → enabling …` / `Ensemble N specialists` / `Caching on`
  block before running, prompting `Press Enter to continue, Ctrl+C to abort`
  under TTY and appending `(auto-proceeding in CI)` otherwise.
- `--thorough` flag: dispatches 3 specialists with two-round cross-annotation
  (default is 2 specialists, single round). `--yes` skips the preflight
  prompt non-interactively.
- Structured specialist verdicts with agreement-based synthesis skip: when 2
  (or 3 under `--thorough`) specialists emit a byte-identical structured
  skeleton (`sectionOutline` + `riskList` for spec;
  `phaseList` + `depGraph` for plan; `findings` + `openQuestions` for
  research), the synthesizer is skipped, the first specialist's draft is
  written as the canonical artifact, and an audit line is appended noting
  how many specialists agreed. Disagreement falls back to synthesis;
  malformed output falls back to synthesis with a warning.
- Prompt caching of stable stage inputs: the builder and reviewer
  invocations now pass `constraints.md → taste.md → spec.md` via a
  hash-named temp file + `--append-system-prompt-file` and
  `--exclude-dynamic-system-prompt-sections`. `build_complete` and
  `review_complete` trajectory entries include `cacheReadInputTokens` and
  `cacheCreationInputTokens`.
- `ridgeline ui [build-name] [--port <n>]` — fully offline dark-mode build
  monitoring dashboard served from `127.0.0.1` (default port 4411 with
  30-attempt free-port fallback). Live-updates over Server-Sent Events with
  a 2 s polling fallback on disconnect. Selects the most recently modified
  build under `.ridgeline/builds/*` when no name is given. Zero external
  assets: inline HTML/CSS/JS, inline SVG favicon, system font stacks.
- `src/ui/color.ts` — semantic terminal-color helper (`error`, `success`,
  `warning`, `info`, `hint`, `bold`, `dimInfo`, `stripAnsi`,
  `clearLineSequence`). Honors `NO_COLOR` and strips on non-TTY streams.
- Sensor `install-hint` preflight line: when a visual surface is detected
  and Playwright is not resolvable, preflight prints a one-line install
  command suggestion.
- Optional `playwright` peer dependency (`>=1.57.0 <2.0.0`); `axe-core` and
  `wcag-contrast` as direct dependencies.
- Concurrent spinners on parallel phases are gated by a process-wide
  singleton so only one spinner draws at a time.
- Per-phase `handoff-<phaseId>.md` fragments for wave parallelization —
  each parallel builder writes into its worktree's fragment, and
  `consolidateHandoffs` stitches them back into the canonical `handoff.md`
  after the wave merges. Eliminates merge-conflict drops.

### Changed

- Reviewer verdict gains a `sensorFindings: SensorFinding[]` field; empty
  by default, populated by the builder loop from the per-phase
  `sensors/<phaseId>.json` after each build run.
- Prompt assembly order for cacheable stages is
  `constraints.md → taste.md (if present) → spec.md (if present)`, written
  to `os.tmpdir()/ridgeline-stable-<sha256>.md` and passed via
  `--append-system-prompt-file`. Session-stable across retries of the same
  phase.
- `shape.md` may now declare a `## Runtime` section with a literal line
  `- **Dev server port:** <n>` so the Playwright sensor short-circuits the
  `5173 / 3000 / 8080 / 4321` probe chain.
- Terminal UI modules (`spinner.ts`, `transcript.ts`, `output.ts`,
  preflight, logger, color itself) route every color through
  `src/ui/color.ts` — no raw ANSI escape codes in feature modules.
- `ridgeline check` is reduced to a one-line stub; preflight now carries
  the real project-prerequisites signal.
- `buildAgentRegistry()` takes no arguments and resolves prompts from
  `src/agents/{core,planners,researchers,specialists,specifiers}` only.
- Ensemble quorum relaxed: a single surviving specialist synthesizes with a
  warning, rather than aborting the stage.
- `build_complete` and `review_complete` trajectory entries include
  `cacheReadInputTokens` and `cacheCreationInputTokens` drawn from the
  Claude CLI usage block.

### Removed

- `src/flavours/` — all 15 flavour directories and every per-flavour
  prompt / pack.
- `src/engine/discovery/flavour.resolve.ts` and `flavour.config.ts`.
- `flavour.json` and all references to `.ridgeline/flavour.json`.
- The `--flavour` / `--flavor` CLI flag. Any occurrence now exits non-zero
  with an actionable deprecation message.
- The `flavour` field from `RidgelineConfig`, `RidgelineSettings`,
  `ResearchConfig`, `RefineConfig`, `SpecEnsembleConfig`, and the
  `state.json` on-disk schema.
- `--deep-ensemble` as a documented flag (still accepted, hidden, and
  mapped to `--thorough` with a stderr deprecation line).
- The `docs/flavours.md` page and all `--flavour` rows in flag tables
  across `docs/`.

### Breaking

- **The flavour system is gone.** `src/flavours/` (all 15 directories,
  including `data-analysis`, `game-dev`, `legal-drafting`,
  `machine-learning`, `mobile-app`, `music-composition`, `novel-writing`,
  `screenwriting`, `security-audit`, `software-engineering`,
  `technical-writing`, `test-suite`, `translation`, `web-game`, `web-ui`)
  is deleted from disk. The `--flavour` / `--flavor` flag on any
  subcommand now exits non-zero with an actionable message pointing at the
  detection-driven replacement. Pipelines select sensors and ensemble
  sizing from the `DetectionReport`; there is no capability-pack or
  per-domain prompt override in 0.8.2.
- The `state.json` `flavour` field is removed. 0.7.x build directories are
  not migrated — start a new build.
- `--deep-ensemble` is no longer a documented flag. It still works (as a
  hidden alias for `--thorough`) and prints a one-line stderr deprecation,
  but users should migrate to `--thorough`.
- Node.js floor raised from prior implicit to an explicit
  `engines.node: ">=20.0.0"`. Set by Playwright's active-support baseline.
- No capability-pack abstraction is introduced. Tool selection is driven by
  detection; there is no pluggable domain-pack layer to hook into.
- 0.7.x builds cannot be resumed against the 0.8.2 pipeline.

## v0.7.21 — 2026-04-22

### Changed

- `/version` skill now prints the drafted CHANGELOG section back to the user as a fenced markdown block before prepending it to `CHANGELOG.md` and committing, giving a chance to interrupt if the prose needs changes

### Fixed

- `build --resume` against a mutated `phases/` directory (e.g. a sub-phase split between runs) no longer throws "Phase {id} not found in state"; `loadOrInitState` now reconciles `state.phases` against disk on resume — preserving completed entries, appending new files as pending, and dropping entries whose files are gone

### Internal

- Add `scripts/**` to `.fallowrc.json` entry list so `bump-version.mjs` isn't flagged as dead (it's invoked by the `/version` preflight, not imported from code)

## v0.7.20 — 2026-04-22

### Added

- Phase filenames may now carry a letter suffix (e.g. `1a`, `1b`) so a phase can be split without renumbering the rest of the plan

### Changed

- `/version` skill refactored: deterministic work (dirty-tree check, semver math, `package.json` rewrite) now runs in `scripts/bump-version.mjs` as a preflight step, leaving the skill body responsible only for summarizing commits, drafting CHANGELOG prose, and running git; release-commit convention switched from `chore: bump version to X.Y.Z` to plain `vX.Y.Z`, with the bump script recognizing both for backward compatibility

### Fixed

- `/version` preflight now exits 0 on expected errors (dirty tree, usage, runtime) so the skill body can branch on the JSON result instead of being short-circuited by a non-zero exit

### Internal

- Ridgeline 0.8.0 `improve` planning artifacts: split phases 1 and 3, add de-risking criteria, add sub-agent proposal, drop the flavour concept from the 0.8.0 spec, realign `shape.md`, and tidy markdownlint ignores

## 0.7.19

- Fix software-engineering planner prompts that claimed `opus (~1M tokens)` and `sonnet (~200K tokens)`: with settings.json now able to pin `claude-opus-4-7` (200K window), the stale "opus = 1M" estimate was causing the synthesizer to collapse plans into fewer, oversized phases. Replace the model-keyed bullets in `core/planner.md` and `planners/context.md` with a single line stating the real 200K window and a ~100K target per phase

## 0.7.18

- Resolve model from `.ridgeline/settings.json` via a new `resolveModel(optModel, ridgelineDir)` helper (CLI opt > `settings.json` > `"opus"`); drop the hardcoded `"opus"` default from every commander `--model` option so the settings.json value can win, and thread the helper through `resolveConfig` plus all commands that read `opts.model` directly (shape, spec, research, refine, design, catalog, retrospective, create) — lets users pin a specific model (e.g. `claude-opus-4-7`) without passing `--model` every time

## 0.7.17

- Capture a plain-text build transcript (`<buildDir>/transcript.log`) with all human-facing output (printInfo/Warn/Error/Phase, Claude stream text, tool events, ensemble completion lines); ANSI escapes stripped so the file stays readable
- Fix retrospective silent-failure: the agent was told to append to `.ridgeline/learnings.md` but only had `Write`, so it often emitted the retrospective as text and never called a tool while the harness logged success unconditionally; the agent now returns the markdown as its response and the harness validates and `appendFileSync`s it, warning on empty or malformed output
- Lint cleanup across code, markdown, and fallow (drop unused `err` in `mergePhaseWorktree`, exclude `.worktrees/**` from markdownlint, whitelist intentional full-interface exports, auto-fix heading/list/fence spacing in `plans/*.md`)

## 0.7.16

- Redirect pnpm/npm user-config to `/dev/null` in the greywall sandbox via a new optional `env()` contribution on `SandboxProvider`, so `pnpm exec <tool>` invocations (typecheck, lint, test, etc.) no longer exit 254 on the seatbelt denial of `~/.npmrc` — registry tokens stay inaccessible to the agent
- Gitignore `.worktrees/`

## 0.7.15

- Switch spawned claude subprocesses from `--system-prompt` to `--append-system-prompt` so Claude Code's default harness (skill discovery, built-in reminders) is preserved alongside ridgeline's flavour prompts
- Pass `--setting-sources project,local` so target repos' `.claude/settings.json` and `.claude/settings.local.json` — including project-defined skills, permissions, and hooks — load in every subprocess
- Add `Skill` to `allowedTools` for builder, reviewer, planner synthesizer, researcher specialists and synthesizer, and retrospective

## 0.7.14

- Add optional `[input]` argument to `spec` command — pass a file path (e.g. `idea.md`) or raw text to seed the spec ensemble with authoritative user-authored guidance that the synthesizer preserves alongside shape.md
- Warn before overwriting existing `spec.md`/`constraints.md`/`taste.md` (aborts in non-interactive sessions)
- Extract shared `resolveInput` helper for file-or-text argument resolution across commands
- Update research docs to reflect inverted ensemble default (ensemble is now default, `--quick` is the opt-out)
- Add architecture and redesign planning documents

## 0.7.13

- Fix shader-validate tool detection (binary is `naga`, not `naga-cli`)

## 0.7.12

- Fix agent-browser package name in skill compatibility docs (was @anthropic-ai/agent-browser, correct package is agent-browser)
- Add documentation for design, catalog, retrospective, and check commands

## 0.7.11

- Remove unused type exports (PhaseGraph, LogLevel) flagged by fallow dead-code analysis
- Deduplicate clone groups: extract countByField helper for catalog/design, retryOrFail closure for phase retry logic
- Reduce complexity in runBuild and invokeEnsemble by extracting focused helper functions
- Fix build-catalog test type mismatches

## 0.7.10

- Extend asset catalog to support all media types (audio, video, text) alongside images
- Add `--classify` flag to catalog command for AI-based category assignment of uncategorized files
- Add filename heuristic classification (e.g., `bgm_*` → music, `sfx_*` → sfx) with Claude AI fallback
- Add `mediaType`, `fileSizeBytes`, `extension`, `isClassified`, and `classificationConfidence` fields to `AssetEntry`
- Add category defaults for audio (music, sfx, ambience, dialogue), video (cinematics), and text (data, docs)
- Add mermaid diagrams to 7 docs: build-lifecycle, review-and-feedback, constraints-and-taste, research, flavours, sandboxing, shaping, and architecture (asset catalog flow)

## 0.7.9

- Add `PromptDocument` class separating trusted instructions from injected data across all prompt assembly (7 exec files migrated)
- Add trajectory-based state recovery: `loadState()` reconstructs `BuildState` from `trajectory.jsonl` when `state.json` is missing or corrupt
- Add git worktree-based parallel phase execution for DAG waves with `Promise.allSettled()` and sequential merge
- Add filesystem locking (`withFileLock`) on `budget.json` and `state.json` for concurrent write safety
- Add per-phase handoff fragments with post-wave consolidation for parallel builds
- Thread optional `cwd` parameter through the full phase execution stack for worktree isolation

## 0.7.8

- Add DAG-based phase scheduling with dependency declarations (`depends_on` frontmatter, parallel wave detection, cycle/missing-dep validation)
- Add two-round cross-specialist ensemble communication (`--deep-ensemble` flag for annotated synthesis)
- Add compound learning via retrospective stage (`ridgeline retrospective <build>`, auto-invoked after successful builds)
- Add structured JSONL logging on by default (`.ridgeline/builds/<build>/log.jsonl`, disable with `--no-structured-log`)
- Add exponential backoff with jitter and error classification to retries (transient vs fatal short-circuit)
- Cache agent registry by flavour path for process lifetime (perf improvement)
- Replace `as any` casts in state.ts with typed `setPipelineStage` helper
- Add warning logging to silent git tag operations
- Add architecture rationale and stakeholder guide documentation with academic citations

## 0.7.7

- Add 48 tests covering pipeline state helpers, flavour resolution, QA clarification loop, and design catalog context — overall statement coverage rises from 83.8% to 90.2%

## 0.7.6

- Add `ridgeline catalog` command for processing image assets into `asset-catalog.json` with tiered enrichment (deterministic metadata extraction via sharp/colorthief, optional vision descriptions via `--describe`, sprite atlas packing via `--pack`)
- Integrate asset catalog into design and build phases (auto-run catalog when assets exist, inject catalog summary into designer context, reference catalog in builder prompts)
- Add `tsconfig.check.json` to cover all TS directories (src, test, top-level) in typecheck
- Fix test mocks across 12 files to match evolved type definitions (RidgelineConfig, PipelineState, ShapeDefinition, AgentRegistry, SandboxProvider)

## 0.7.5

- Fix synthesizer stall-kill during large Write tool calls (e.g., research on iteration 3+) by prompting synthesizers to emit a status line before each Write and bumping their stall timeout from 5 to 8 minutes

## 0.7.4

- Default research command now runs all 3 specialists (academic, ecosystem, competitive); add `--quick` flag for single random specialist (replaces `--deep`)
- Show spinner during research agenda-building phase instead of silent pause
- Render ensemble synthesizer streaming text in dim grey to match other command output
- Add structured summary table for research command with per-specialist duration, cost, and token breakdown
- Extract shared `formatDuration`/`formatTokens` into `src/ui/summary.ts`

## 0.7.3

- Add full agent coverage for web-game and web-ui flavours (40 new agents: core, planners, researchers, specialists, specifiers)
- Add domain gap checklists for web-game (browser compatibility, WebGL, audio autoplay) and web-ui (design system, responsive, a11y)
- Add `flavour.json` with `recommendedSkills` for all 12 remaining flavours
- Add `ridgeline check` command for flavour tool prerequisites

## 0.7.2

- Add crash-safety handlers (`uncaughtException`, `unhandledRejection`, `exit`) to kill orphaned Claude subprocesses when Node crashes
- Introduce atomic writes for `state.json` and `budget.json` via write-to-temp + rename to prevent corruption from mid-write crashes
- Add unit tests for shape, research, refine, rewind, and create commands
- Add troubleshooting guide (`docs/troubleshooting.md`) covering 9 common failure scenarios
- Add step-by-step custom flavour creation walkthrough to `docs/flavours.md`

## 0.7.1

- Replace bespoke tool family pipeline with Claude skills 2.0 adapters in `plugin/visual-tools/` — 7 skills: agent-browser, visual-diff, css-audit, a11y-audit, lighthouse, canvas-screenshot, shader-validate
- Add `web-ui` flavour for web application UI development with responsive screenshots, CSS audit, and accessibility checks
- Add `web-game` flavour for browser-based games and interactive visual apps (canvas, WebGL, PixiJS, Phaser, Three.js)
- Enhance `software-engineering` flavour with visual awareness for projects that include UI
- Add `flavour.json` config with `recommendedSkills` — flavours declare which tool skills work best with them
- Show recommended tool availability at project creation (`ridgeline create`) with install commands for missing tools
- Discover bundled plugins shipped with ridgeline via `getBundledPluginDir()`
- Remove `toolFamily` from shape definitions — skills handle tool discovery via Claude's native skill matching
- Extract shared QA workflow module (`qa-workflow.ts`) from design and shape commands, eliminating duplication
- Simplify `logTrajectory` API by inlining `makeTrajectoryEntry`
- Split `feedback.verdict.ts` into `feedback.parse.ts` and `feedback.format.ts`
- Extract `stream.types.ts` for shared stream parsing types
- Resolve all fallow lint failures: 0 dead code, 0 duplication, 0 above health threshold

## 0.7.0

- Add visual design system: shape detection engine scans shape.md against keyword registries to identify visual concerns (web-visual, game-visual, print-layout)
- Add `ridgeline design` command for interactive design.md creation with hard tokens and soft guidance, supporting both project-level and feature-level design artifacts
- Auto-chain from shape to design when visual concerns are detected — seamless flow from shaping questions to design questions
- Add design.md resolution and injection into all pipeline stages (planner, builder, reviewer) alongside constraints and taste
- Add visual coherence specialist that conditionally joins the specifier ensemble (4 specialists instead of 3) when visual shapes match
- Add web-visual tool family plugin with graceful degradation: Playwright screenshots, Project Wallace CSS audit, axe-core accessibility, pixelmatch visual diff, and Lighthouse audits
- Inject shape-specific design heuristics into reviewer prompts with hard token violations as blocking and soft guidance deviations as suggestions
- Add `design` as an optional pipeline stage with rewind support

## 0.6.2

- Improve shape step output legibility: separate questions with blank lines, render suggestions and status messages in grey, add file-path input hint
- Remove redundant tool name suffix from build spinner line (already shown in grey above)

## 0.6.1

- Make research.md accumulative across iterations — findings append to a Findings Log, Active Recommendations rewritten each iteration from all findings
- Add `spec.changelog.md` written by the refiner to track what changed in spec.md per iteration, read by both researcher and refiner to avoid redundant work
- Add research agenda pre-step (sonnet) that evaluates the spec against a domain gap checklist before dispatching specialists, focusing web searches on actual spec gaps
- Add `gaps.md` domain gap checklists for all 13 flavours plus a base checklist for generic software projects
- Change `--auto` default from 3 to 2 iterations
- Update all documentation for accumulative research, spec.changelog.md, gap analysis, and flavour researchers

## 0.6.0

- Add `ridgeline research` and `ridgeline refine` as optional pipeline stages between spec and plan
- Research ensemble uses web-sourced specialists (academic, ecosystem, competitive) with quick and deep modes
- Refine merges research findings back into spec.md via a dedicated refiner agent
- Add `--auto [N]` flag for iterative research-refine loops
- Add `isStructured` flag to ensemble engine for prose output (used by researcher)
- Create researcher and refiner agents for all 13 flavours
- Update all documentation for research/refine pipeline and `--flavour` flag
- Add docs/research.md as a comprehensive standalone guide for the research feature
- Fix stale `--to` help text in the rewind CLI command

## 0.5.9

- Use wall-clock duration instead of Claude's self-reported time for build/review budget entries
- Compute summary table column width dynamically so long phase names don't break alignment
- Add acceptance criteria verification step to builder agents, reducing avoidable review failures
- Scope-limit reviewer agents to targeted inspection and verifier delegation instead of full audits
- Propagate builder and reviewer improvements to all 13 flavours with domain-adapted language
- Add shaping guide for non-technical users

## 0.5.8

- Fix StructuredOutput being ignored when the result event already contains prose text, causing planner specialists to fail JSON parsing with `--json-schema`

## 0.5.7

- Fix built-in flavours not found when running from a global install (flavours were not copied to dist during build)
- Add flavours guide covering usage, structure, and pipeline effects

## 0.5.6

- Clean up build summary table: remove redundant phase counts header, widen dividers to match row width, add token usage and elapsed time footer
- Fix e2e pipeline test to expect specialist/synthesizer budget roles instead of planner
- Make e2e feedback-file assertion resilient to builder retries
- Remove unused `discoverBuiltinAgents` and `resolveSpecialistsDir`

## 0.5.5

- Remove worktree isolation — builder now writes directly to the main repo, giving users live visibility into build progress
- Remove `isMerged` phase state and worktree merge step (`reflectCommits`, `mergePhaseIntoMain`, `retryUnmergedPhases`)
- Fix pipeline state loss when restarting a build with empty phases but existing pipeline metadata

## 0.5.4

- Split `stream.decode.ts` into `stream.parse`, `stream.result`, and `stream.display` modules
- Split `feedback.ts` into `feedback.verdict` (pure logic) and `feedback.io` (filesystem)
- Extract `executeBuild`, `executeReview`, and `handleExhaustion` from `runPhase` to reduce cognitive complexity

## 0.5.3

- Stream e2e test output in real-time instead of buffering until completion

## 0.5.2

- Rename `scout` specialist to `explorer` across all flavours and docs
- Rename `store/` directory to `stores/` to reflect collection semantics
- Remove dead exports and fix duplication flagged by fallow lint

## 0.5.1

- Add 10 new agent flavours: game-dev, mobile-app, technical-writing, legal-drafting, screenwriting, music-composition, security-audit, test-suite, translation, machine-learning

## 0.5.0

- Add `--flavour` flag to all CLI commands for pluggable agent sets
- Add agent registry with per-folder flavour-to-default fallback resolution
- Add flavour resolver supporting built-in names and filesystem paths
- Refactor ensemble pipeline to accept pre-resolved specialists
- Move software-engineering agents to `src/flavours/software-engineering/`
- Write domain-agnostic generic default agents in `src/agents/`
- Add novel-writing and data-analysis built-in flavours
- Support flavour configuration via `.ridgeline/settings.json`

## 0.4.4

- Update helloworld example to match current pipeline artifacts (add shape.md, pipeline state, isMerged)
- Update documentation to reflect shape/spec/plan/build pipeline, rewind command, and ensemble stages
- Add ensemble flows guide covering specifier and planner pipelines
- Consolidate redundant ensemble-planning doc into ensemble-flows

## 0.4.3

- Fix fallow dead-code, duplication, and complexity lint errors
- Remove unused exports (`resolveAgentDir`, `discoverSpecialists`, `EnsembleConfig`, `CreateOptions`)
- Extract `resolveBuildDir` helper to deduplicate build directory setup across commands
- Extract `requireBuildName` and `handleCommandError` to deduplicate CLI command handlers
- Extract `formatProposalHeading` to deduplicate specialist proposal formatting
- Decompose `rewindTo` into `collectStageFiles` and `resetPipelineState` to reduce complexity

## 0.4.2

- Extract generic ensemble runner (`invokeEnsemble`) from specifier and planner pipelines, deduplicating ~150 lines of orchestration logic
- Fix lint errors in tests, markdown, and agent validation

## 0.4.1

- Rename `sketchers/` to `specifiers/` and `sketch.exec.ts` to `specify.exec.ts` to better reflect that these agents produce structured spec proposals
- Fix pipeline diagram label (SKETCH → SHAPE)

## 0.4.0

- Add four-stage pipeline: `shape → spec → plan → build` replacing the single `spec` command
- New `ridgeline shape` command with shaper agent that conducts adaptive Q&A and codebase analysis, producing `shape.md` (Shape-Up inspired pitch format)
- New spec ensemble: 3 specialists (completeness, clarity, pragmatism) propose drafts in parallel, specifier synthesizes into `spec.md`, `constraints.md`, `taste.md`
- Default command (`ridgeline <name>`) walks users through the pipeline via state tracking, dispatching to the next incomplete stage
- New `ridgeline rewind <name> --to <stage>` command to reset pipeline state and clean up downstream artifacts
- Extend `state.json` with `pipeline` field tracking stage completion across shape, spec, plan, and build
- Brownfield-aware: shaper pre-fills answers from existing code analysis while always letting users confirm

## 0.3.15

- Dim tool call lines (dark grey) so conversational LLM output stands out during builds
- Add blank line before tool→conversation transitions for visual breathing room
- Zero-pad seconds in summary table durations and fix column alignment for the Attempts header
- Reduce cognitive complexity in `runBuild`, `runPhase`, and `extractResult` to pass fallow thresholds
- Eliminate duplicated build/review error handler in phase.sequence.ts

## 0.3.14

- Track per-phase merge state (`isMerged`) so resume correctly retries failed merges instead of thinking the build is done
- Abort stale in-progress merges before retrying, recovering from interrupted runs that left the repo in a conflicted state
- Backfill `isMerged` for legacy state.json files so existing builds can resume properly

## 0.3.13

- Replace fallback git merge with rebase-then-fast-forward so user changes on main (e.g. version bumps) are preserved while builder work layers on top
- Add build output improvements: phase progress headers, merge visibility, retry reasons, and summary table on failure
- Detect expired OAuth tokens and fail immediately instead of retrying or masking with misleading "could not parse verdict" errors
- Kill orphaned Claude subprocesses on Ctrl+C or build failure using process group isolation (detached spawn + SIGKILL)
- Fix phase.sequence test committing dirty files to the real repo due to missing git mock
- Fix double "Error: Error:" prefix in CLI error handlers

## 0.3.12

- Fix worktree merge failure when untracked files (e.g. package-lock.json) in the main repo conflict with files committed in the WIP branch; detect and remove conflicting untracked files before merging since the WIP branch is authoritative

## 0.3.11

- Fix npm install blocked by greyproxy: sync network allowlist domains as greyproxy rules via its REST API instead of writing an unsupported `network.allowlist` key to the greywall settings file

## 0.3.10

- Fix empty reviewer diff: commit builder work before review so `git diff checkpoint..HEAD` is populated
- Fix npm install stalling in sandbox: add package manager cache directories (~/.npm, ~/.cache, ~/.yarn, ~/.pnpm-store, ~/.cargo, ~/.local/share) to greywall allowWrite list

## 0.3.9

- Increase tool summary truncation limit from 80 to 200 characters so file names are visible in build output
- Strip project root from Bash command summaries, not just file-path tools
- Add `nodejs.org`, `objects.githubusercontent.com`, `raw.githubusercontent.com` to default sandbox network allowlist
- Support `"*"` wildcard in network allowlist for unrestricted internet access

## 0.3.8

- Fix `--json-schema` result extraction: the Claude CLI uses a synthetic `StructuredOutput` tool, so JSON responses live in `tool_use.input`, not the result field
- Add assistant text fallback in `extractResult` for when the result field is empty
- Add e2e planner tests that invoke the real Claude CLI to verify structured output handling

## 0.3.7

- Fix specialist planner prompt: strip conflicting markdown file-writing instructions that caused models to return prose instead of JSON
- Remove unused `failVerdict` export from test factories

## 0.3.6

- Fix planner specialist JSON parsing: extract JSON from markdown fences and text-wrapped output instead of failing silently
- Add diagnostic preview to specialist parse errors for easier debugging
- Remove unused imports flagged by oxlint

## 0.3.5

- Add `@vitest/coverage-v8` and `npm run coverage` script for code coverage reporting
- Fill test coverage gaps across the pipeline execution layer (build.exec, review.exec, plan.exec, pipeline.shared, ensemble.exec), raising overall coverage from ~78% to 92%
- Add shared test factories (`test/factories.ts`) for configs, phases, results, and verdicts
- Extend existing tests for worktree, sandbox greywall, agent prompt, build/spec commands, and state management
- Enrich existing docs with deeper rationale and add new docs for review/feedback, build lifecycle, and constraints/taste

## 0.3.4

- Add `--context` flag to the `build` command for passing extra context to builder and planner prompts

## 0.3.3

- Resolve all fallow duplication and complexity errors: extract shared pipeline boilerplate, reduce cognitive complexity in parseVerdict/runBuild/runSpec, and deduplicate CLI and worktree init logic
- Configure fallow with test duplication exclusions and reasonable complexity thresholds; fallow now exits cleanly without `|| true` fallback
- Fix fallow dead-code warnings by unexporting internal-only types and removing unused barrel re-exports
- Rename specialist agents for clarity: navigator → scout (later renamed explorer), depender → auditor, checker → verifier
- Add ensemble planning documentation
- Fix documentation drift: correct non-existent CLI flags and broken cross-references

## 0.3.2

- Rename `dryRun.ts` and `dryRun.test.ts` to kebab-case (`dry-run.ts`, `dry-run.test.ts`) for consistent file naming

## 0.3.1

- Remove prompt-based network guard hook now that greywall handles sandboxing at the OS level

## 0.3.0

- Ensemble planning: the planner now spawns multiple specialist agents in parallel (simplicity, thoroughness, velocity), collects structured proposals, and synthesizes the best ideas into final phase files
- Planner personalities are defined as agent files in `agents/planners/` and discovered at runtime — adding a new perspective requires no code changes
- Success threshold scales to the number of discovered specialists (requires at least half to succeed)

## 0.2.26

- Display relative paths in tool call lines by stripping the project root, so truncated lines remain distinguishable
- Fix summary table column alignment by using a shared row formatter for header, planning, phase, and total rows

## 0.2.25

- Fix worktree merge failure when untracked build metadata files (handoff.md) conflict with WIP branch — now stages and commits them before merging
- Show each LLM tool call on its own line during builds (e.g. `[Bash] npm test`, `[Read] /src/index.ts`) with the spinner always at the bottom
- Extract tool input summaries from Claude stream events (command, file_path, pattern, prompt) with 80-char truncation
- Add `printAbove()` to spinner for printing permanent lines above the animation

## 0.2.24

- Fix sandbox merge failure: grant buildDir write access in greywall/bwrap so the builder writes handoff.md to the correct location instead of creating a duplicate inside the worktree
- Fix missing final phase code: commit dirty worktree files before reflectCommits so every phase's work lands on the WIP branch before merging into main

## 0.2.23

- Fix greywall sandbox: pass network allowlist via `--settings` file so greyproxy permits Claude's required domains (API, downloads, telemetry)
- Always merge `CLAUDE_REQUIRED_DOMAINS` into the network allowlist, even when users override it
- Use `--auto-profile` for filesystem permissions and `--no-credential-protection` to preserve OAuth tokens

## 0.2.22

- Disable greywall credential protection (`--no-credential-protection`) to fix OAuth 403 errors
- Simplify greywall invocation to `--auto-profile` only, relying on the built-in Claude profile

## 0.2.21

- Use greywall `--auto-profile` to apply the built-in Claude profile, fixing sandbox auth hangs on macOS

## 0.2.20

- Auto-initialise git repo with environment-aware .gitignore and initial commit when target directory lacks one, fixing worktree creation failures
- Pass network allowlist through to greywall sandbox settings so configured domains are actually reachable
- Surface Claude stderr (auth errors, failures) immediately during builds instead of swallowing until timeout

## 0.2.19

- Fix double blank lines and missing line breaks in streamed LLM output
- Suppress verbose JSON verdict blocks from reviewer terminal output
- Rewrite build summary table: unified layout with planning/per-phase/total sections and spec description
- Spinner now pauses during text streaming and resumes during tool-use pauses

## 0.2.18

- Fix reviewer receiving empty diff by running git checkpoint/diff operations in the worktree instead of the main repo
- Record cache token fields (cacheReadInputTokens, cacheCreationInputTokens) in budget.json for accurate token tracking
- Add fallow linter to lint pipeline
- Add ecosystem position and integration strategy docs

## 0.2.17

- Fall back to unsandboxed mode with warning when greyproxy is not running, instead of blocking builds
- Fix spinner flickering on build errors by stopping spinner in finally blocks
- Fix greyproxy readiness check to match `✓` symbol instead of bare substring

## 0.2.16

- Fail fast with actionable error when greyproxy is not running instead of silently hanging
- Fix stall detector: only reset timer on stdout (real progress), not stderr (CLI keepalive)

## 0.2.15

- Prune stale git worktree entries before creating new ones to fix branch-in-use errors after a crash or kill

## 0.2.14

- Fix worktree creation failing when a WIP branch already exists from a previous crashed or killed build

## 0.2.13

- Add stall detection: kill Claude process if no output for 5 minutes during execution (configurable via `stallTimeoutMs`)
- Add startup probe: kill Claude process if no output within 2 minutes of spawn (configurable via `startupTimeoutMs`)
- Show active tool name on spinner line during builds (e.g., `[Read]`, `[Bash]`) by parsing tool_use stream events

## 0.2.12

- Fix LLM output not displaying during builds by supporting the current Claude CLI stream-json message format
- Exclude `src/agents/core/` from agnix linter (loaded via `--plugin-dir`, not auto-discovery)
- Add lint workflow note to CLAUDE.md

## 0.2.11

- Fix Greywall sandbox provider to use `--settings` flag with a temporary settings JSON file instead of invalid `--allow-dir` CLI flag

## 0.2.10

- Replace opt-in `--sandbox`/`--allow-network` with auto-detected sandbox-by-default (`--unsafe` to opt out)
- Add Greywall sandbox provider for macOS/Linux with domain-level network allowlisting
- Extract bwrap into a sandbox provider behind a common `SandboxProvider` interface
- Add `.ridgeline/settings.json` for project-level configuration (network allowlist with sensible defaults)
- Add git worktree isolation — each build runs in `.ridgeline/worktrees/<build-name>`, completed phases reflected back via fast-forward merge
- Add `ridgeline clean` command to remove stale worktrees and WIP branches
- Add PreToolUse network guard hook (blocks curl/wget/ssh in `--unsafe` mode only)
- Add sandboxing and access control research doc with community project survey
- Update SECURITY.md, README, and help docs for new security model

## 0.2.9

- Add opt-in bwrap sandbox for builder and reviewer agents (`--sandbox`, `--allow-network`) — Linux-only kernel-level filesystem and network isolation
- Create SECURITY.md documenting permission scoping, git checkpoints, budget controls, prompt architecture, and tradeoff decisions
- Update README with accurate CLI flags and defaults (fix timeouts, remove non-existent `--verbose`, add `--check-timeout`)
- Fix `ridgeline run` references to `ridgeline build` in dryRun.ts and phase.sequence.ts

## 0.2.8

- Add colocated tests for `ui/` modules (output, spinner, prompt) and `config.ts`
- Add `deleteTagsByPrefix` coverage to git tests

## 0.2.7

- Extract config resolution and interactive prompts from `cli.ts` into `config.ts` and `ui/prompt.ts`

## 0.2.6

- Move `logging.ts` to `ui/output.ts` and rename `logInfo`/`logError`/`logPhase` to `printInfo`/`printError`/`printPhase` — user-facing status output is a UI concern
- Add end-to-end tests for the full plan → build → review pipeline using real Claude CLI calls

## 0.2.5

- Reorganize engine/ into subdirectories (discovery/, pipeline/, claude/) with `[domain].[type].ts` naming convention and colocated tests
- Add `typecheck` script and make `test` run typecheck, lint, and unit tests together

## 0.2.4

- Rename `runner/` directory to `engine/` and `state/` directory to `store/` for clearer module roles
- Add barrel `index.ts` modules for engine, store, commands, and ui to simplify imports

## 0.2.3

- Rename stateManager module to state for single-noun naming consistency with sibling modules

## 0.2.2

- Extract feedback (verdict parsing, formatting, persistence), trajectory (event logging, querying), and phases (discovery, validation) into dedicated state modules
- Extract git tag naming conventions and lifecycle operations (checkpoint, completion, cleanup) into state/tags.ts
- Move build input resolution (resolveFile, parseCheckCommand) from cli.ts into state/inputs.ts
- Add parsePhaseContent to state/phases.ts for structured title/goal/criteria extraction from phase markdown
- Runner modules now focus purely on Claude invocation; state concerns live in src/state/

## 0.2.1

- Add 4 specialist sub-agents: navigator (codebase exploration), checker (intelligent verification), tester (acceptance-level test writing), depender (module graph integrity)
- Restructure agents/ into core/ and specialists/ subdirectories, replacing the .core exclude manifest with directory-based discovery
- Remove harness-level check command from phaseRunner — the builder now uses the checker sub-agent as its internal feedback loop
- Pass specialist sub-agents and plugin directories to the reviewer, giving it the Agent tool for delegated verification
- Remove the snapshot feature entirely — models explore dynamically rather than consuming tokens resolving stale codebase snapshots
- Fix build script to clean dist/agents before copying to prevent nesting on rebuild

## 0.2.0

- Discover built-in specialist agents from `src/agents/` (excluding core pipeline agents via `.core` list) and pass them to the builder via `--agents` CLI flag as native subagent types
- Support user-provided plugin directories at `.ridgeline/plugin/` (project-level) and `.ridgeline/builds/<name>/plugin/` (build-level) for skills, agents, commands, hooks, and MCP servers
- Auto-generate `plugin.json` in plugin directories when missing; clean up after build
- Add `--agents` and `--plugin-dir` support to `claudeInvoker`
- Add `ridgelineDir` to `RidgelineConfig`

## 0.1.12

- Add bouncing-bar spinner during LLM invocations with 50 whacky random verbs
- Spinner integrates into `createDisplayCallbacks` so all invocation sites get it automatically

## 0.1.11

- Rename `run` command to `build` and `init` command to `spec`
- `spec` command accepts a positional input arg (file path or natural language description)
- Specifier agent pre-fills clarification answers from user-provided input context
- Rename agent `init.md` to `specifier.md` and `reviewerInvoker` to `reviewInvoker`

## 0.1.10

- Always stream LLM assistant text to stdout with blank line separators between harness log lines
- Extract NDJSON parsing into modular `streamParser.ts` with pure functions (no I/O)
- Simplify `claudeInvoker.ts` to a generic subprocess runner with `onStdout` callback
- Remove `--verbose` flag — streaming is now the default behavior
- Add `createDisplayCallbacks()` helper for wiring up display in invokers
- Add `docs/output-system.md` documenting the output architecture and future work

## 0.1.9

- Merge `resume` command into `run` (auto-detects and resumes from last successful phase)
- Reset retries on resume so incomplete phases get full fresh attempts
- Add per-phase summary table showing attempts, build/review time, and cost
- Preserve numbered feedback files per retry for post-build analysis
- Auto-cleanup git tags on successful build completion
- Increase default timeouts: builder/reviewer 2h, check command 20m
- Add `--check-timeout` flag for configurable check command timeout
- Load CLI version from package.json at runtime instead of hardcoding
- Extract shared `resolveAgentPrompt` module to eliminate duplication
- Reviewer receives only diffs; reads files on demand via tools
- Exclude `examples/` from linters

## 0.1.8

- Fix crash when re-running or resuming builds with pre-existing checkpoint/completion git tags
- Update README to reflect read-only reviewer and harness-generated feedback

## 0.1.7

- Make reviewer agent read-only to fix verdict parsing failures (JSON verdict was lost after Write tool calls)
- Add structured `ReviewIssue` type with description, file, severity, and requiredState fields
- Replace regex-based verdict parser with brute-force JSON extraction for robustness
- Move feedback.md generation from reviewer agent into harness (phaseRunner)
- Fix stale init command tests broken by prior multi-turn conversation refactor

## 0.1.6

- Redesign init command as CLI-driven multi-turn conversation instead of spawning interactive Claude Code session
- Add `--resume` and `--json-schema` support to `invokeClaude()` for session continuity and structured output
- Add init agent prompt (`src/agents/init.md`) for guided Q&A and build file generation
- Add `--model`, `--verbose`, and `--timeout` options to `ridgeline init`

## 0.1.5

- Fix stream-json parsing crash when Claude CLI emits trailing events after result
- Fix Buffer type incompatibility and exclude test files from tsc build
- Add helloworld example as standalone project with README and build artifacts

## 0.1.4

- Rename evaluator role to reviewer across codebase (types, agents, tests, CLI, docs)
- Add project README with overview, CLI usage, and build structure
- Add ridgeline lore document with conceptual metaphors

## 0.1.3

- Add oxlint and markdownlint-cli2 linters with lint scripts (lint, lint:code, lint:markdown, lint:agents)
- Add agnix linter for agent markdown validation
- Pin all dependency versions and update TypeScript to 5.9.3
- Fix unused imports across source and test files
- Fix fenced code block language specifiers in builder agent

## 0.1.2

- Add CLI tool with plan, build, evaluate, dry-run, resume, and init commands
- Add state management, git checkpointing, budget tracking, and trajectory logging
- Add vitest test suite with 112 tests across 16 files covering all modules
- Export CLI utility functions (resolveFile, parseCheckCommand, resolveConfig) for testability

## 0.1.1

- Add builder agent system prompt for implementing single-phase specs
- Add evaluator agent system prompt for reviewing phase output against acceptance criteria
- Add planner agent system prompt for decomposing project specs into phased build plans
- Add package.json and MIT license
