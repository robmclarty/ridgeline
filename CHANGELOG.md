# Changelog

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
