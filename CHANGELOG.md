# Changelog

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
