## Phase 1a: Flavour removal, agent-registry rewire, package metadata, test pruning

### What was built

Three commits on `improve1`:

1. `b9bd238 refactor(agents): route agent.registry.ts through src/agents/ only`
   — `buildAgentRegistry()` now takes no parameter and resolves prompts
   exclusively from `src/agents/{core,planners,researchers,specialists,specifiers}`.
   All eleven pipeline-entry callers updated. New
   `src/engine/discovery/__tests__/agent.registry.resolution.test.ts` exercises
   every pipeline-entry command's canonical core-prompt set.
2. `d250874 feat(flavours)!: remove flavour system; ship 0.8.0 deprecation error`
   — Deletes `src/flavours/` (15 directories, ~22k lines),
   `src/engine/discovery/flavour.{resolve,config}.ts`, and ten flavour-importing
   test files. Reworks `src/commands/{check,create}.ts`. Drops `flavour` from
   `RidgelineConfig`, `RidgelineSettings`, `ResearchConfig`, `RefineConfig`,
   `SpecEnsembleConfig`, and from every command option type. Removes `--flavour`
   from every CLI subcommand. New `src/utils/flavour-removed.ts` pre-screens
   `process.argv` at the top of `cli.ts`: any occurrence of `--flavour` /
   `--flavor` exits non-zero with an actionable message. New
   `src/utils/__tests__/flavour-removed.test.ts` is a 48-test parameterised
   matrix across all ten pipeline-entry commands × four sample flavour values.
   Replacement tests `src/engine/pipeline/__tests__/extract-json.test.ts`
   (9 tests) and re-created flavour-free versions of `pipeline.shared.test.ts`,
   `build.exec.test.ts`, `review.exec.test.ts` preserve unrelated coverage.
   Docs cleanup: `docs/flavours.md` and `docs/check.md` removed; `--flavour`
   rows removed from flag tables; "Domain Flavour System" section retired from
   `architecture-rationale.md`; flavour mentions stripped from
   `shaping.md`, `stakeholder-guide.md`, `infrastructure-audit.md`,
   `ensemble-flows.md`, `architecture.md`, `research.md`.
3. `8ee4bb5 chore(deps): bump to 0.8.0; add engines, peer playwright, axe-core, wcag-contrast`
   — `package.json` version → `0.8.0`; `engines.node` → `">=20.0.0"`;
   `peerDependencies.playwright` → `">=1.57.0 <2.0.0"` (optional);
   adds `axe-core@4.10.3` and `wcag-contrast@3.0.0` to `dependencies`;
   removes `dist/flavours` copy step from the `build` script.

Other artifacts:

- `.ridgeline/builds/improve/phase-1a-baseline.json` — pre-phase test counts.
- `.ridgeline/builds/improve/phase-1a-checkpoint.txt` — HEAD after the rewire
  commit, for one-step rewind: `git reset --hard b9bd238`.
- `scripts/verify-phase-1a-coverage.sh` — CI-runnable coverage-floor check.
- `.fallowrc.json` — allowlists `axe-core` and `wcag-contrast` until phase
  1b/2 sensors import them.

### Decisions

- **`buildAgentRegistry()` takes no parameter** instead of an ignored
  `flavourPath`. The cleaner signature forced all callers to update in the
  rewire commit, but it's worth it: no dead parameter, no future temptation
  to wire flavour back in.
- **Universal `--flavour` deprecation guard** at the top of `cli.ts` rather
  than per-command `.option()` declarations that would emit Commander's
  generic "unknown option" error. The pre-screen catches every command and
  every spelling (`--flavour`, `--flavor`, `--flavour=name`) with one
  actionable message.
- **Re-added `pipeline.shared.test.ts`, `build.exec.test.ts`,
  `review.exec.test.ts` as flavour-free versions** rather than deleting them
  outright. Substantial non-flavour coverage was at risk; restoring it as
  modifications (git diff sees them as `M`, not `D`) keeps the deletion set
  honest while preserving the unit-test surface.
- **`src/commands/check.ts` reduced to a stub.** Criterion 28 requires that
  it not warn about missing flavours or packs; the simplest path is a
  one-line "No project checks configured." The command stays for stability;
  preflight (phase 1b) will replace it with real signal.
- **`A` (added test files) per criterion 19** counted strictly against the
  baseline commit `0b64c37`: three genuinely new files
  (`agent.registry.resolution.test.ts`, `flavour-removed.test.ts`,
  `extract-json.test.ts`). The three re-added files are modifications, not
  additions, so they don't count toward `A` — but their preserved coverage
  pushes `N_end` above the floor anyway.

### Deviations

- **Two pre-existing environmental test-suite failures persist** —
  `src/__tests__/git.test.ts`, `src/engine/__tests__/worktree.test.ts`,
  `src/engine/pipeline/__tests__/worktree.parallel.test.ts` all fail under
  greywall on macOS because `git init` cannot copy hook templates from
  `/Library/Developer/CommandLineTools/...` into the sandbox-confined `/tmp`.
  Identical 28 failures at baseline (`589 passing / 28 failing` before, `590
  passing / 28 failing` after). Not introduced by this phase. The
  install-and-check gate (criterion 8) therefore exits non-zero on this
  workstation; the verification script confirms no regression. Phase 5
  cleanup or a future sandbox-aware test harness should address it.
- **Coverage-floor formula interpreted as file counts** (matching criterion
  1's "count of test files"): `N_end (590) >= N_baseline (589) - D (7) +
  A (3) = 585`. Run `bash scripts/verify-phase-1a-coverage.sh` to reproduce.

### Notes for next phase

- **Phase 1b adds `src/engine/detect/`, `src/ui/preflight.ts`, and
  `src/ui/color.ts`** per the spec. The `--thorough` and `--yes` flags are
  also slated for 1b; they should integrate cleanly with the
  `enforceFlavourRemoved` pre-check (which only matches `--flavour` /
  `--flavor`).
- **`src/utils/flavour-removed.ts` is the canonical removal pattern.** When
  future phases retire other flags, follow the same shape: a small pure
  module with `detect…`, `…Message`, `enforce…` exports and a parameterised
  test matrix.
- **`axe-core` and `wcag-contrast` are installed but unused.** The
  `.fallowrc.json` allowlist will need pruning once the contrast and a11y
  sensors land in phase 2 — remove them from `ignoreDependencies` then.
- **`peerDependencies.playwright` is optional.** Phase 1b's preflight will
  detect when a visual surface is present and prompt the user to
  `npm i playwright` if the module isn't resolvable.
- **`ridgeline check` is now a one-liner stub.** Phase 5 may either expand it
  with the new preflight summary or remove it entirely.
- **Resolution test** (`agent.registry.resolution.test.ts`) hard-codes the
  pipeline-entry → core-prompt mapping. If new pipeline-entry commands or
  core agent prompts land, update the `COMMAND_TO_CORE_PROMPTS` table.
- **Flavour removal pre-check uses `process.argv.slice(2)`.** This runs
  before Commander parses anything, so subcommand resolution doesn't matter
  — `ridgeline anything --flavour x` will trip it.
