# Parallel-wave reliability follow-ups

Backlog from the fascicle-migration build incident (2026-05-06/07): the wave
scheduler ran two phases (`02-sandbox-policy` and the reconcile-created
`02-sandbox-policy.builder-progress` twin) in the same wave even though they
modified the identical set of files. The first auto-merged; the second hit a
7-file conflict and the build halted with `Branch preserved`.

## Context (one-liner pointers)

- Wave scheduler: `src/commands/build.ts:340-355`
- Ready-set logic: `src/engine/pipeline/phase.graph.ts` (`getReadyPhases`,
  `hasParallelism`)
- Reconcile-on-resume creates `*.builder-progress` twins — the entry point that
  added `02-sandbox-policy.builder-progress` and `03-adapters.builder-progress`
  during the resume run (search log.jsonl for `Reconciled state: added`).
- Conflict-handling path: see `Merge conflict for ...` log line; ends with
  `Branch preserved: ridgeline/<build>/<phase>` and the wave loop exits.

## Tasks

### 1. Add `--serial` / `--max-parallel <n>` to `ridgeline build`

**Why:** today there is no way to opt out of wave scheduling at the CLI. The
only lever is editing each phase's `depends_on` frontmatter, which is brittle
and per-build.

**How to apply:**

- Add the flag(s) to the command in `src/commands/build.ts` (next to
  `--require-phase-approval`).
- Plumb a `maxParallel` value into `executeWaveLoop` and clamp the result of
  `getReadyPhases` to that size before handing off to `runParallelWave`.
- `--serial` is sugar for `--max-parallel 1`. With max=1, prefer
  `runAndTrackPhase` directly (skip worktree-isolation overhead since there's
  no parallelism).
- Update `docs/build-lifecycle.md` and the `--help` text.

**Acceptance:** running `ridgeline build <name> --serial` produces exactly one
phase per "wave" in the log; no `Wave: N parallel phases (...)` line where N
> 1.

### 2. Detect file-overlap between phases scheduled in the same wave

**Why:** the immediate trigger of the incident was that the reconcile twin and
its original both touched `sandbox.policy.ts`, `sandbox.ts`, three test files,
`.fallowrc.json`, and `phase-2-check.json`. The scheduler had no way to see
this — the DAG only encodes declared `depends_on`, not file footprint.

**How to apply (sketch):**

- After the builder runs, the diffs are visible in the worktree. The current
  flow merges them sequentially in index order (`build.ts:248`). The merge
  step already knows about conflicts.
- Cheaper detection upstream: when scheduling a wave, peek at each phase's
  declared touched-paths (if we add a `touches:` frontmatter key) and refuse
  to schedule overlapping phases in the same wave — fall back to
  sequential.
- Or: post-hoc — if a wave's merge fails for one phase but succeeded for
  another that touched the same files, automatically retry the failed phase
  serially against the new merged tip rather than just preserving the branch.

**Acceptance:** simulated build with two phases that touch the same file does
not produce an unrecoverable `Branch preserved` halt — either the scheduler
serializes them, or the merge phase replays the loser onto the new HEAD.

### 3. Don't create `.builder-progress` twins for already-landed phases

**Why:** during the resume run, ridgeline created `03-adapters.builder-progress`
even though the phase-3 source had been committed manually to main while the
build was offline (commits `a61bbb4` + `c16e6be`). Re-running it would have
produced a second merge conflict for no benefit.

**How to apply:**

- Reconcile logic should compare the original phase's checkpoint/completion
  tag commit against `main` HEAD. If the tag is reachable from main (i.e.,
  the work is already merged), mark the phase complete instead of creating a
  twin.
- For partial cases (some files merged, others not), still create a twin but
  log clearly which files are already on main so the builder can skip them.

**Acceptance:** a build resumed after a manual merge of a phase's work does
not schedule a redundant twin for that phase.

### 4. Branch cleanup (one-time, fascicle-migration-specific)

These two preserved unmerged branches can be deleted once you're confident
nothing in them is missed:

```sh
git branch -D ridgeline/fascicle-migration/02-sandbox-policy
git branch -D ridgeline/fascicle-migration/03-adapters
```

- `02-sandbox-policy` is superseded by the merged `.builder-progress` twin
  (commit `20ed251`). The diff between them is cosmetic — see the report at
  the top of this conversation.
- `03-adapters` is superseded by hand-landed commits `a61bbb4` +
  `c16e6be`. The phase-3 source on main matches what this branch produced.

If you want a paranoid check before deleting:

```sh
git diff main..ridgeline/fascicle-migration/02-sandbox-policy -- src/
git diff main..ridgeline/fascicle-migration/03-adapters -- src/
```

## Order of operations

1. Task 4 (branch cleanup) — minutes; isolated.
2. Task 1 (`--serial` flag) — small CLI change; immediate value for the
   remaining fascicle-migration phases (already serial by DAG, but having the
   flag makes future builds safer).
3. Task 3 (skip already-merged twins on reconcile) — moderate; prevents the
   exact incident from recurring.
4. Task 2 (file-overlap detection) — larger; touches the scheduler. Defer
   until 1 + 3 are landed and we see whether the simpler fixes are enough.
