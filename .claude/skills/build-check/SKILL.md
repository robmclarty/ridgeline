---
name: build-check
description: Validate that the repo and a build's directory are ready for `ridgeline build`. Runs `npm run check`, parses `.check/summary.json`, verifies the planner has produced phases, checks node_module deps, git state, and spec-vs-repo consistency. Identifies anything that would hang up a build agent or burn budget on retries — missing system deps, broken tests, stale phase artifacts, spec referents that don't exist. Writes build-check.md with status ready, needs-attention, or broken. Use when the user runs `/build-check [build-name]` or asks to validate readiness before `ridgeline build`.
argument-hint: "[build-name]"
allowed-tools: Read, Write, Glob, Grep, Bash(npm run check*), Bash(node scripts/check.mjs*), Bash(git status*), Bash(git rev-parse*), Bash(git branch*), Bash(node -v*), Bash(npm -v*), Bash(which *), Bash(test -d *), Bash(test -f *), Bash(wc *), Bash(date *), Bash(stat *), Bash(find src -type f -newer*)
---

# build-check

Verify that the repo is in a state where `ridgeline build <name>` can run without hanging or burning budget on avoidable retries. Writes a verdict to `.ridgeline/builds/<name>/build-check.md`.

This skill is **read-only**: it inspects the repo, runs `npm run check`, and writes one output file. It never edits source, never mutates `.ridgeline/builds/<name>/` artifacts beyond writing `build-check.md`. The companion `/build-fix` skill handles repairs.

## Arguments

`$ARGUMENTS` — one positional arg: the build name (e.g., `fascicle-migration`). No default; fail fast if missing.

## Inputs and preflight

1. **Resolve `BUILD_DIR`.** Set `BUILD_DIR=.ridgeline/builds/$ARGUMENTS`. Working directory is the repo root.
2. **Confirm the build dir exists** with Glob on `.ridgeline/builds/$ARGUMENTS/`. If not:
   - Glob `.ridgeline/builds/*` to list available builds.
   - Write a `broken` `build-check.md` (single blocker `[B1] build directory missing`) with a referral to `ridgeline shape` / `ridgeline spec` / `ridgeline plan`. Stop.
3. **Confirm `spec.md` and `constraints.md` exist**. Missing either → blocker; continue with the other checks so the user sees the full set, but the result is `broken`.

## The check.md output format

Identical to `spec-check.md` (see the `/spec-check` skill for the canonical shape). Path: `.ridgeline/builds/$ARGUMENTS/build-check.md`. Frontmatter `check_kind: build`.

Status mapping is mechanical:

- any blocker → `broken`
- no blockers + ≥1 warning → `needs-attention`
- otherwise → `ready`

H2 sections always present (even if empty, with `(none)`): `## Blockers`, `## Warnings`, `## Recommendations`, `## What was checked`, `## Raw artifacts`. `/build-fix` parses by heading.

## The 9 checks

Run all nine, then aggregate. Don't short-circuit on the first blocker.

### 1. Build dir + state sanity

- Read `.ridgeline/builds/$ARGUMENTS/state.json`. Confirm it's valid JSON. If absent or malformed → blocker `[B?] state.json missing or invalid` (user needs to re-run `ridgeline plan`).
- Look for a `pipeline` field with a `plan` step marked `complete` (or equivalent — read the existing `state.json` shape from `fascicle-migration/` if unsure). If plan isn't complete → blocker "no plan yet — run `ridgeline plan $ARGUMENTS` before building".
- Glob `.ridgeline/builds/$ARGUMENTS/phases/*.md`. If zero phase files exist → blocker `[B?] no phase files in phases/`.

### 2. `npm run check` green

**Freshness rule.** If `.check/summary.json` exists, read its `timestamp`. Use Bash `find src -type f -newer .check/summary.json` (head_limit 1) — if any source file is newer than the summary, the summary is stale and you must re-run. Otherwise trust it.

To re-run: `npm run check` (allow up to 5 minutes; the typical run is ~15s). On exit code 2 (orchestrator error, not a tool failure), do NOT continue to per-tool parsing — emit a single blocker `[B?] check orchestrator failed` with the verbatim stderr under Evidence, and skip the rest of this check. The `/build-fix` skill recognizes this marker and refuses to dispatch.

Parse `.check/summary.json`:

```json
{"timestamp":"...","ok":true,"total_duration_ms":15285,
 "checks":[{"name":"types","ok":true,"exit_code":0,"output_file":null}]}
```

For each `checks[i]` with `ok === false`:

- Emit a blocker `[B?] check failed: <name>`.
- `Location`: `npm run check: <name>`.
- `Evidence`: read `.check/<name>.json` or `.check/<name>.stdout.txt` (whichever `output_file` points to, or the convention) and extract the first 3–5 diagnostic lines.
- `Touches`: parse the diagnostics for file paths (lint/types/test diagnostics carry them); collect into the array. If none extractable, leave `Touches:` empty — `/build-fix` will fall back to single-agent dispatch.

### 3. Constraints check command actually runs

Mirror the regex from `src/stores/inputs.ts:20` against `constraints.md`:

````regex
/## Check Command\s*\n+```[^\n]*\n([\s\S]*?)```/
````

- No `## Check Command` → blocker (planner phases need it; this is a duplicate signal with check #7 in spec-check, but build-check has to check it too because constraints can change between `/spec-check` and `/build-check`).
- Command present and equals `npm run check` → already covered by check 2; no separate run needed.
- Command present but differs from `npm run check` → for this skill, do NOT run it (the `allowed-tools` whitelist only permits `npm run check` and `node scripts/check.mjs`). Instead emit a warning `[W?] custom check command differs from npm run check; verify it manually`.

### 4. Git state

- `git status --short`. Empty output → clean tree, info line in "What was checked".
- Non-empty → warning `[W?] working tree is dirty`; Evidence lists the changed files (first 10).
- Files inside `.ridgeline/builds/$ARGUMENTS/` showing up in `git status` other than `build-check.md` itself → warning `[W?] in-flight build artifacts (possible interrupted run)`.
- `git rev-parse --abbrev-ref HEAD` → record the current branch in "What was checked" (just for the audit trail; not a blocker).

### 5. Node/runtime deps present

This is the user's "missing system dependency" example — the most common cause of build agents hanging.

- Read `package.json`:
  - If `engines.node` is set: run `node -v`, compare. Mismatch → warning `[W?] node version mismatch` (Evidence shows `engines.node` vs `node -v` output).
  - For each top-level `dependencies` key (skip `devDependencies` for this check): use Bash `test -d node_modules/<dep>`. Missing → blocker `[B?] dependency not installed: <dep>`. Suggested fix: `npm install`. Roll up multiple missing deps into one blocker with all names listed under Evidence.
- For binaries the check command shells out to: `vitest`, `oxlint`, `tsc`, `cspell`, `markdownlint-cli2`, `ast-grep`, `agnix`, `fallow`. For each, `test -f node_modules/.bin/<name>`. Missing → blocker (rolled up).

### 6. Spec/constraints/taste internal consistency

Apply check #3 from the `/spec-check` skill (cross-file consistency: spec restates constraints, taste/constraints contradictions, stale §N references). This is intentional duplication — the user may not have run `/spec-check` recently, and `/build-check` is the last gate before `ridgeline build`.

### 7. Spec vs repo reality

For each "file structure" entry in `spec.md`, use the pattern below to extract the path:

```regex
^-\s+`(src/[^`]+)`\s+—
```

- A matching entry typically reads: `- (path) — does X` where path is in single backticks.
- Extract the path and the action verb (look for "create", "new", "add", "modify", "extend", "replace" in the line and the next 1–2 lines).
- Glob the path.
- Spec says "create"/"new" but file exists with substance (`wc -l` > 5) → warning `[W?] file marked as new but already exists`.
- Spec says "modify"/"extend"/"replace" but file is missing → blocker `[B?] referenced source missing`.

### 8. Phase artifacts

Glob `.ridgeline/builds/$ARGUMENTS/phases/*.md`. For each phase file `<id>.md`:

- Look for matching `phase-<index>-check.json` in `BUILD_DIR/`. (The index is the leading numeric prefix in the phase filename, e.g., `01-scaffold.md` → `phase-01-check.json`.)
- If present and JSON shows `status: "failed"` (or equivalent) → blocker `[B?] phase <id> previously failed`; Evidence cites the JSON. This signals a resumed build that left a phase in failed state.
- If absent → no entry needed (expected for unstarted phases).

### 9. Budget headroom

- Read `.ridgeline/builds/$ARGUMENTS/budget.json` if it exists. Skip the check entirely if it doesn't.
- Look for a configured cap. Sources, in order: `--max-budget` is a CLI flag (not in this scope), `.ridgeline/config.json` may set `maxBudgetUsd`, `package.json` may carry it under `ridgeline.maxBudgetUsd`. Read `.ridgeline/config.json` if present.
- If a cap is set and total spent in `budget.json` is within 10% of the cap → warning `[W?] budget headroom < 10%`.
- No cap, or plenty of headroom → info line in "What was checked"; no warning.

## Process

1. Preflight: resolve `BUILD_DIR`, confirm dir + `spec.md` + `constraints.md`. Write the minimal `broken` file and stop only if `BUILD_DIR` is missing — other preflight failures are blockers that still let the rest of the checks run.
2. Run all 9 checks. Collect findings as `{id, severity, title, location, evidence, suggestedFix, touches[]}`.
3. Compute status mechanically.
4. Compose `build-check.md` using the shared format (see `/spec-check`). Assign IDs sequentially within each severity.
5. `Write` `build-check.md`. Overwrite any existing file.
6. Print one line: `build-check: <status> — N blockers, M warnings, K recommendations. See .ridgeline/builds/<name>/build-check.md`.

## Edge cases

- **`.check/` doesn't exist at all** (first run): just run `npm run check` from scratch; no freshness comparison needed.
- **`npm run check` exits non-zero but not 2** (tool failure, not orchestrator failure): expected — parse `summary.json` and emit one blocker per failed tool. Status `broken`.
- **`npm run check` hangs past 5 minutes**: treat as orchestrator failure (exit code 2 equivalent). Emit `[B?] check orchestrator timeout`. Do not retry inside this skill.
- **`state.json` schema unknown**: don't crash. If the JSON is valid but doesn't carry a `pipeline.plan.complete` flag, look at `.ridgeline/builds/$ARGUMENTS/phases/` instead — phases present = plan is done. Note the inferred-state in "What was checked".
- **Binary check (#5) on a fresh clone with `node_modules/` removed**: every binary missing. Roll up into one blocker `[B?] node_modules not installed` rather than ten separate blockers.
- **A `phase-N-check.json` file with malformed JSON**: warning, not blocker. `/build-fix` shouldn't be asked to repair malformed JSON it didn't write.

## Anti-patterns

- **Don't fix anything.** No `Edit`, no `npm install`, no `git restore`. Diagnostic only.
- **Don't relax `npm run check`.** If a test fails, that's a blocker — don't downgrade because it "looks flaky".
- **Don't run the constraints check command if it differs from `npm run check`.** The `allowed-tools` whitelist forbids it, and arbitrary commands could mutate the repo.
- **Don't omit empty H2 sections.** `## Blockers\n(none)` is required for the format to be machine-readable.
- **Don't speculate on causes.** Cite evidence from the artifacts you read. "Test X failed because the function Y was renamed" is OK only if you saw the rename in the diagnostic output.
