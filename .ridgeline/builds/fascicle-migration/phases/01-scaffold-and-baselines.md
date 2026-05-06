# Phase 1: Scaffold, Dependencies, and Baseline Capture

## Goal

Establish the foundation that every later phase will measure itself against, without changing any externally observable behavior. Add fascicle and zod as runtime dependencies, bump engines.node from `>=20` to `>=24`, drop Node 20 from CI, and create the empty directory tree where the new substrate will live (`flows/`, `atoms/`, `composites/`, `adapters/`).

Capture every pre-migration baseline artifact that later phases will assert against — CLI `--help` text byte snapshots, command external-signature `.d.ts` snapshots, recorded `trajectory.jsonl`/`state.json`/`budget.json`/`phases/` fixtures, error-shape fingerprints (name + message) for adversarial round-cap exhaustion / schema-validation / auth / budget-exceeded paths, the current Stryker mutation score on `src/engine/pipeline/`, an enumerated greywall integration test name list, and a verified `claude_cli` capability matrix pinned to the fascicle version. The breadth of these baselines is what makes the substrate swap auditable rather than aspirational.

Seed the next minor-version CHANGELOG entry with a prominent BREAKING-FOR-CONSUMERS callout for the Node 24 bump. Stage (but do not enforce) ast-grep rules that will become enforcing in later phases when their target files exist.

## Context

This is the first phase of an eight-phase substrate swap. The migration replaces ridgeline's hand-rolled orchestration internals (`src/engine/pipeline/`, `src/engine/claude/{claude.exec,stream.parse,stream.result,stream.display,stream.types}.ts`) with the fascicle library while preserving every externally observable behavior. At Phase 1, no code paths change behavior — the existing pipeline still runs every command end-to-end. Only dependencies, directory scaffolding, baselines, and CHANGELOG seeding land here.

The migration is executed by a separately installed stable ridgeline binary operating on a worktree of main; the binary under migration never executes itself. Phase exit commits use subject prefix `phase-0:` (matching the spec's 0-indexed phase numbering even though the file is `01-...`).

## Acceptance Criteria

1. `package.json` declares `fascicle` under `dependencies` (not devDependencies, not peerDependencies) with a version range starting `^0.3.`.
2. `package.json` declares `zod` under `dependencies` with a version range starting `^3.`.
3. `package.json` `engines.node` is `>=24`.
4. `package.json` contains zero references to `@ai-sdk/anthropic` or `ai` in `dependencies`, `devDependencies`, or `peerDependencies`.
5. Every CI workflow file under `.github/workflows/` contains zero matches for `node-version: 20`, `node: 20`, or any matrix entry naming Node 20; only Node 24 (or 24+) is exercised.
6. Directories `src/engine/flows/`, `src/engine/atoms/`, `src/engine/composites/`, `src/engine/adapters/` exist; each contains an `index.ts` that re-exports nothing yet.
7. `.ridgeline/builds/fascicle-migration/baseline/help/<command>.txt` exists for `ridgeline --help` and every subcommand's `--help` output. At minimum, entries exist for: `ridgeline`, `build`, `auto`, `dry-run`, `research`, `plan`, `retro-refine`, `retrospective`, `qa-workflow`, `directions`, `design`, `shape`, `spec`, `ingest`, `refine`, `rewind`, `catalog`, `check`, `clean`, `create`, `input`, `ui`. Snapshots are recorded at a stable terminal width (e.g., `COLUMNS=120`) so they are reproducible.
8. `.ridgeline/builds/fascicle-migration/baseline/dts/` contains the `tsc --emitDeclarationOnly` output of every `src/commands/*.ts` external function signature.
9. `.ridgeline/builds/fascicle-migration/baseline/fixtures/` contains `trajectory.jsonl`, `state.json`, `budget.json`, and `phases/` recorded from a successful pre-migration `ridgeline build`.
10. `.ridgeline/builds/fascicle-migration/baseline/fixtures/error-shapes.json` records `error.name` and `error.message` for each of: adversarial round-cap exhaustion, schema-validation failure, auth failure, budget-exceeded.
11. `.ridgeline/builds/fascicle-migration/baseline/fixtures/builder-modelcall-input.json` records the `ModelCallInput` (or its closest pre-migration equivalent — the resolved `system + messages + tools + schema` payload handed to the model invocation) for a frozen `BuilderArgs` input. This anchors the prompt-cache hit-rate stability test in Phase 5.
12. `.ridgeline/builds/fascicle-migration/baseline/mutation-score.json` records the Stryker mutation score on `src/engine/pipeline/` at this commit.
13. `.ridgeline/builds/fascicle-migration/baseline/capability-matrix.md` records the verified fascicle version pinned in `package.json` and its `claude_cli` provider capabilities: sandbox kinds (none/greywall/bwrap), auth modes (auto/oauth/api_key), streaming events (StreamChunk types), cost reporting fields, AbortSignal propagation behavior, model alias set, `startup_timeout_ms` default, `stall_timeout_ms` default, `skip_probe` behavior, `install_signal_handlers` default. Each capability is verified against the pinned fascicle version's docs/source, not assumed.
14. `.ridgeline/builds/fascicle-migration/baseline/exit-codes.md` enumerates every exit code currently emitted by ridgeline (success, generic failure, SIGINT 130, auth failure, budget-exceeded, schema-validation failure) with the trigger condition for each.
15. `.ridgeline/builds/fascicle-migration/baseline/greywall-tests.txt` lists the names of every greywall integration test under `src/engine/__tests__/` (and elsewhere) that exists at this commit. Phase 3 will assert each of these passes unchanged.
16. `.ridgeline/builds/fascicle-migration/baseline/sandbox-allowlist.semi-locked.json` and `sandbox-allowlist.strict.json` record the network allowlist hosts derived from the pre-migration `sandbox.greywall.ts`. Phase 3 will snapshot the new policy's allowlists against these.
17. `.ridgeline/builds/fascicle-migration/baseline/README.md` documents how every baseline artifact was produced (commands run, environment variables, terminal width, tool versions). Any later phase can regenerate the artifacts deterministically from this document.
18. `CHANGELOG.md` contains a new entry under the next minor version (after 0.11.2) with at minimum: (a) a top-of-entry BREAKING-FOR-CONSUMERS callout that `engines.node` is bumped to `>=24`; (b) a bullet noting the internal substrate migration to fascicle; (c) a bullet stating that public CLI behavior is unchanged.
19. Ast-grep rule files for boundary-enforcement are added under the project's existing ast-grep rules directory but staged as non-enforcing for any rule whose target file does not yet exist (e.g., `no-create-engine-outside-factory` cannot enforce until Phase 6). Each staged rule has a comment noting the phase that will activate it.
20. `npm run check` is green.
21. `ridgeline build` runs end-to-end against an existing build (still on the legacy pipeline) with no behavioral change.
22. `.ridgeline/builds/fascicle-migration/phase-0-check.json` captures the `.check/summary.json` snapshot at the phase-exit commit and shows zero failures across types, lint, struct, agents, dead code, docs, spell, tests.
23. The phase exit commit subject begins with `phase-0:`.

## Spec Reference

- spec.md → "Phase 0 — Scaffold, dependencies, and baseline capture": dependency additions, Node 24 bump, directory tree, baseline corpus, CHANGELOG seeding.
- spec.md → "Test coverage and mutation testing scope": baseline capture for Stryker mutation score on `src/engine/pipeline/`.
- spec.md → "Terminal output and artifact format preservation": baseline capture for golden-file snapshots referenced in later phases.
- constraints.md → "Language and Runtime", "Framework and Core Dependencies", "Phase Discipline", "Test and Mutation Constraints".
- taste.md → "Test Patterns": fixture-driven snapshot tests as the regression net for byte-fidelity assertions.
