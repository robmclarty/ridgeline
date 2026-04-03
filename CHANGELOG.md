# Changelog

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
