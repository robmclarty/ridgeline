# Build Learnings

## Build: fascicle-migration (2026-05-07)

### Build Defects

- **Phase 10 (mutation tests) ran under `captured: false` placeholders** because Stryker's child-proxy IPC connect was killed by the greywall sandbox (`AggregateError: EPERM` at `internalConnectMultiple`). The builder went five continuations in a row — `halt_max_continuations` — before the harness escalated to the operator. AC2/AC3 were eventually satisfied only by an out-of-band host-side run; the in-build attempt produced gate output `DEFERRED` (exit 0) that, by design, would have let the phase ship with no comparison ever performed. Five wasted continuations on this single phase cost ~$11.

- **`src/cli.ts` was silently renamed to `src/main.ts` in Phase 08** to dodge a fascicle-0.3.8 bin-self-detection bug (`if (process.argv[1].endsWith("/cli.js")) run_viewer_cli(...)` at fascicle/dist/index.js:7195). The constraints.md "directory layout: src/cli.ts — entry point" was left mismatched and AC10 passes only because the reviewer accepted the rename. The upstream bug was not patched, upstreamed, or worked around at the import boundary — the public-facing artifact name was changed to accommodate someone else's bug.

- **Phase 09's first SIGINT regression test was vacuous.** The fixture spawned a minimal `compose("sigint_test", step(...))` with no worktree creation, no child process, and a sandbox-blocked `ps` call whose `EPERM` swallow made `orphanCount` always 0 — so `after <= before` (0 ≤ 0) passed regardless of behavior. Sub-criteria (b)/(c)/(d) were never actually verified in the first review pass; only the retry produced a real fixture with a git worktree + spawned child.

- **Phase 09's first attempt left `src/commands/build.ts` importing 9 symbols from `src/engine/pipeline/`** (runPhase, four phase-graph helpers, four worktree helpers) despite AC11's parenthetical "no command path imports it." The handoff acknowledged this as a deferral; the retry only resolved it by inventing a `src/engine/legacy/` re-export bridge — the legacy executors weren't replaced, they were renamed to satisfy the literal grep.

- **Phase 11 was a lift-and-shift, not a substrate swap.** ~4400 LOC of spawn-based legacy executors (build.loop, review.exec, runClaudeProcess, ensemble executors) were renamed and moved to `src/engine/` root rather than rewritten on the atom + composite stack the spec required. The handoff is explicit: *"The build pipeline (executeBuildPhase → runBuilderLoop → runBuilder → runReviewer → runClaudeProcess) remains spawn-based via the renamed runClaudeProcess. The fascicle Engine is used at the orchestration layer ... but not at the per-LLM-call layer."* The migration ships a mixed substrate; the user is inheriting a TODO labeled "future phase," not a completed migration.

- **`agnix` binary unavailable inside the sandbox; symlink workaround propagated across phases.** The `agents` sub-check of `npm run check` was greened by `ln -s ../../parent/node_modules/agnix/bin/agnix-binary node_modules/agnix/bin/agnix-binary` in every fresh worktree. The constraint says "every phase-N-check.json must show zero failures across all eight tools" — that was satisfied via filesystem fixup, not by the sandbox actually being able to run the tool. Phase 02's first three reviews failed on this; Phase 03 unblocked it via symlink first.

- **`registerProcessSignal` helper added in Phase 09 explicitly to dodge an AC grep.** The handoff says *"It exists to dodge AC4's grep, not because it adds new behavior. A reviewer might flag this as a workaround."* The grep-AC was treated as the contract instead of "no manual SIGINT handlers."

### What Worked

- **Phases 01, 04, 05, 06, 07, 12 all passed first-attempt review** — six of twelve phases were one-shot. Atom-and-composite layering (phases 5/6/7) had clean prompt structure, schema-referential-equality assertions, byte-stability fixtures, and Tier 2 audits — each a single builder invocation, each green review.
- **`ast-grep` rules as severity:hint → severity:error progression** worked exactly as planned: Phase 0 declared rules as hints, later phases lifted them once their guarded surface had content. Empirical violation probes ("inject a violation, confirm the rule fires") were run in every phase that lifted a rule — concrete evidence the rule actually works.
- **Phase 12's golden-output snapshot suite** (six tests, ten snapshot files) plus the trajectory-event-naming structural test give a real regression net for the §7 invariants checklist. The `UPDATE_GOLDEN_OUTPUT=1` regeneration recipe is the right shape for an expected-output baseline.
- **Phase 03's deferred-callsites manifest** (`phase-3-deferred-callsites.md`) was a clean way to defer migration of `recordCost`/`logTrajectory` callers without losing track. Phase 8 / 9 / 11 each consulted it.
- **Phase 09 retry's SIGINT fixture** ended up genuinely useful: real `git worktree add`, real spawned child with PID file, `process.kill(pid, 0)` ESRCH check (sandbox-portable instead of `/bin/ps`). Reusable template for future end-to-end abort tests.

### What Didn't

- **Phase 02 burned $35.53 across three builder attempts** before producing a green tree, mostly fighting the agnix-binary tool failure rather than producing different sandbox-policy code.
- **Phase 10 burned $24+ on five wasted continuations** in-sandbox, all of which independently rediscovered that Stryker can't connect to localhost under greywall. The harness should have escalated after the second.
- **Phase 11 needed three large builder invocations** (~$65) because attempts 1 and 2 wound down on "more work explicit" — the deletion sequence + consumer migration + atom-stack rewrite was clearly too large for a single phase, and the actual delivery was a lift-and-shift, not the rewrite the spec demanded.
- **Phase 08's first attempt skipped three byte-equality assertion ACs** (.d.ts snapshot, --help baseline, commander option-set) by deferring "by inspection" — all three required a retry.
- **The plan was rejected on the first attempt** with six issues, costing an extra $1.32 + $2.49 + $0.66 in synthesizer churn.
- **Twin "*.builder-progress" phase IDs** appear seven times in state.json. Most are harness reconcile artifacts (one is annotated `Orphan twin from reconcile`), but they double-bill the same phase work in `budget.json` because each twin re-ran build + review.

### Patterns to Repeat

- Single-builder-invocation phases with five+ acceptance criteria targeted at named files + named tests + grep-able invariants (Phase 06, 07, 12) consistently produced first-attempt-pass work. Crisp ACs → crisp builds.
- Tier-progression for ast-grep rules (declare hint, lift to error when surface has content) avoided rule-fires-on-pre-existing-code traps.
- Schema referential-equality assertions (`expect(atom.schema).toBe(reviewVerdictSchema)`) caught the failure mode of "atom imports its own private schema copy" without any real test data.
- Phase-N-check.json verbatim-copy gate caught spell/markdownlint regressions immediately at phase exit, before they cascaded.

### Patterns to Avoid

- **ACs that depend on tools the sandbox blocks.** Stryker (Phase 10), `/bin/ps` for orphan-process detection (Phase 09), agnix's GitHub-fetched binary (every phase), Greywall daemon for greyproxy E2E (Phase 02). Either declare those ACs operator-side up front, or relax the sandbox for the affected phases. Don't pretend they can run inside the sandbox and discover via failure.
- **"Replace X with Y" ACs that are actually rewrites, not replacements.** Phase 11's "delete pipeline/, rewrite via atom-stack" was a multi-thousand-LOC rewrite under a deletion-flavored AC. The builder reasonably backed off to lift-and-shift; the spec should have either split the rewrite into its own phase or accepted lift-and-shift up front.
- **Acceptance criteria phrased as grep tests.** Phase 09's AC4 ("`grep -nE "process\\.on\\(['\"]SIGINT" src/main.ts` returns 0") got dodged via `registerProcessSignal` wrapper. The structural intent ("no manual SIGINT handlers anywhere") would have been enforceable; the literal grep wasn't.
- **Lumping unrelated work into a phase.** Phase 08 absorbed a project-wide ESM conversion (mechanical script + `__dirname` fixes + require shims) that the spec didn't ask for.
- **Halting the builder loop on "no progress" without escalating.** Phase 02 attempt 2 produced zero diff and the harness halted; Phase 10 burned five continuations before the operator was asked to intervene. Tool-availability failures should escalate after one retry, not five.

### Cost Analysis

- **Total: $409.63 over ~22.4 hours of wall clock.** Twelve planned phases, all complete; plan + 17 distinct phase records (with twins).
- **Phase 11 (cleanup-deletions) was the single most expensive phase at $65.30** across three builder invocations. The cost reflected scope (deletion sequence + consumer migration + intended atom-stack rewrite), but the spend bought a lift-and-shift rather than the rewrite.
- **Phase 02 (sandbox-policy) cost ~$60 combined** across multiple attempts, retries, and the twin `02-sandbox-policy.builder-progress` track. Most of that fought tooling, not code.
- **Phase 08 ($50.15) + Phase 09 ($49.93) + Phase 10 ($31.38) ≈ $131** combined, with significant rework — a third of total budget went to phases that needed retries because of tool failures or vacuous tests.
- **The cheaper, cleaner phases** (01: $3.70; 04: $10.35; 05: $16.15; 06: $19.83; 07: $14.22) averaged under $15 each. They were also the phases with the most precise specs and no sandbox/tool collisions.

### Recommendations for Next Build

- **Pre-flight tool inventory in Phase 0.** For each AC that depends on an executable, verify the tool actually runs under the configured sandbox before any builder phase opens. Stryker, Greywall, agnix-binary, `/bin/ps`, `cargo` were all preventable surprises.
- **Mark operator-side ACs explicitly in the spec.** Phase 10's mutation capture had to happen outside the sandbox; the spec didn't say so until the second retry. A "must run on host" tag in the AC list would prevent five wasted continuations.
- **Split rewrites from deletions.** Phase 11 should have been two phases: (a) delete `src/engine/pipeline/` after migrating consumers via existing atoms; (b) atom-stack rewrite of the legacy executors. Bundling them produced a lift-and-shift labeled as a deletion.
- **Tighten "vacuous test" auditing in the reviewer.** A test that always passes under the configured sandbox (because `ps` is `EPERM`-swallowed → 0) should be classified as a defect, not a pass. The Phase 09 first review missed this entirely.
- **Cap continuation chains at 2 for tool-availability failures.** Phase 10's 5-continuation chain was budget waste — the second `EPERM` was as informative as the fifth.
- **Audit AC text for grep-circumventable patterns.** "`grep -nE "process\\.on\\(['\"]SIGINT" returns 0`" is dodge-able by adding a wrapper. Prefer "no module under `src/` installs SIGINT handlers" enforced by an ast-grep rule that pattern-matches handler installation, not the literal call site.
