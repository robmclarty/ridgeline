---
name: build-fix
description: Read a build's build-check.md and fix repo issues so `ridgeline build` can run cleanly. Plans fixes, dispatches parallel subagents grouped by disjoint file sets, re-runs `npm run check` and `/build-check`, and loops until status reaches ready or a 3-iteration cap is hit. Use when the user runs `/build-fix [build-name]` or asks to repair the repo after `/build-check` flagged issues.
argument-hint: "[build-name]"
allowed-tools: Read, Write, Edit, Glob, Grep, Task, Skill, Bash(npm run check*), Bash(npm install*), Bash(date *)
---

# build-fix

Read the verdict produced by `/build-check`, plan repairs, dispatch parallel subagents to apply them, re-run `npm run check` and `/build-check`, and loop until the repo reaches `ready`. The skill stops on success, on a hard 3-iteration cap, or when the verdict carries an orchestrator-level marker that agents can't reasonably fix.

The skill **writes to source files in `src/`, test files, configuration, and possibly `package.json`** via dispatched agents. It does not edit `.ridgeline/builds/<name>/` artifacts beyond `build-check.md` and `build-fix-log.jsonl`.

## Arguments

`$ARGUMENTS` — one positional arg: the build name. No default; fail fast if missing.

## Inputs and preflight

1. **Resolve `BUILD_DIR=.ridgeline/builds/$ARGUMENTS`.** Working directory is the repo root.
2. **Read `BUILD_DIR/build-check.md`.** Missing → print `build-check.md missing — run /build-check $ARGUMENTS first` and stop.
3. **Parse the frontmatter `status` field.**
   - `ready` → print "build-check status is `ready` — nothing to fix" and stop.
   - `needs-attention` or `broken` → continue.
4. **Refuse on orchestrator-level failures.** Grep `build-check.md` for any of these blocker titles:
   - `check orchestrator failed`
   - `check orchestrator timeout`
   - `build directory missing`
   - `state.json missing or invalid`

   Found → print the blocker title, location, and evidence verbatim, then stop. These failures require human intervention; agents will only break things further if dispatched.

## Parsing the check.md

Use Grep with `output_mode: content` and pattern `^### \[` on `build-check.md` to enumerate all H3 issue headings under `## Blockers`, `## Warnings`, `## Recommendations`. For each:

- Extract the ID, severity, location, evidence, suggested fix, touches (comma-separated list of file paths).
- Build `issues = [{id, severity, title, location, evidence, suggestedFix, touches[]}, ...]`.
- Drop recommendations — they're advisory.

## Grouping for parallelism

Two issues belong to the same group if their `touches[]` sets intersect.

- Issues touching the same source file (e.g., two lint errors in `src/foo.ts`) → same group, sequential.
- Issues touching disjoint files (e.g., a type error in `src/a.ts` and a missing dependency `pkg-b`) → different groups, parallel.
- Issues with empty `touches[]` (build-check could not extract paths from the diagnostic) → single fallback group, dispatched after the others.

Compute groups via union-find on the touches sets.

**Hard cap on parallel dispatch:** 4 groups per iteration. If you compute more than 4, merge the smallest groups together until you're at 4 or fewer. This keeps the parent context manageable.

## Dispatching fix agents

For each group, use the subagent-dispatch tool (Task) with `subagent_type: general-purpose`. All agent calls for the iteration go in **one message** (parallel dispatch).

Each agent's prompt:

```text
You're fixing ridgeline build issues for build [name]. The verdict comes from /build-check.

Files in scope: [touches list, joined, plus "and anything else the diagnostic forces you to touch — e.g., updating a test that references a renamed function"].
Working directory: [repo root path].

Issues to fix (verbatim from build-check.md):

[paste each issue's H3 block — title, severity, location, evidence, suggested fix, touches]

Constraints:
- Run `npm run check` after each substantive change to confirm you're making progress. Do not run it after every single edit; batch related edits first.
- Do NOT relax the check to make it pass: no skipping tests, no commenting out assertions, no loosening type annotations to `any`, no deleting failing test files. If a test is genuinely wrong (asserts the old behavior after a deliberate change), edit the test to match the new behavior — but only when the source change is the root cause.
- Do NOT mutate files under .ridgeline/builds/[name]/. State and phase artifacts belong to ridgeline.
- For missing dependencies: run `npm install` to restore `node_modules`. Do not add new packages — the issue is a missing install, not a missing dep.
- If a fix requires a decision only the user can make (ambiguous business logic, design call, schema migration with data risk), do NOT guess. Report the issue ID as skipped with a one-line reason.

Report (in your final message):
- IDs you resolved.
- IDs you skipped, with reason.
- Any new issues you noticed but didn't fix (one line each, advisory only).
```

After all agents return, collect `resolved`, `skipped`, and `observed` sets across groups.

## Re-running the check

1. Run `npm run check`. This regenerates `.check/summary.json`.
2. Invoke the `/build-check` skill via the Skill tool with `args: $ARGUMENTS`. This regenerates `build-check.md` (the check skill will see the fresh `.check/summary.json` and trust it).
3. Re-read `build-check.md` and parse the new `status`.

## Loop

```text
iteration = 1
while iteration <= 3:
  parse issues from build-check.md
  if status == ready: stop with success
  if orchestrator-level marker: stop with escalation
  group issues by disjoint touches (cap at 4 groups)
  dispatch agents (parallel across groups)
  npm run check
  re-invoke /build-check
  iteration += 1
on cap: append a "## Stalled" section to build-check.md and stop
```

The 3-iteration cap is hard. On cap, append (don't overwrite) a `## Stalled` section at the end of `build-check.md` listing each surviving blocker/warning ID and a one-line note quoting the issue's title. Print "stalled — N issues remain" and stop. Do NOT re-dispatch.

## Transcript

Append one line per iteration to `BUILD_DIR/build-fix-log.jsonl`:

```json
{"iteration":1,"timestamp":"...","groups":3,"ids_attempted":["B1","B2","W1"],"ids_resolved":["B1"],"ids_skipped":[],"status_after":"broken"}
```

Use `Edit` if the file exists (append a new line), `Write` to create it. The log is transcript-only; re-running the skill starts fresh from iteration 1.

## Process

1. Preflight: resolve `BUILD_DIR`, read `build-check.md`, check status and orchestrator marker. Stop early on `ready` or marker.
2. Initialize `iteration = 1`. Enter the loop.
3. Parse issues, group, cap at 4 groups, dispatch agents in parallel.
4. Append iteration row to `build-fix-log.jsonl`.
5. Run `npm run check`, invoke `/build-check` via Skill, re-read `build-check.md`.
6. If `status == ready` → success. Print: "build-fix: ready — fixed N issues across M iterations". Stop.
7. If `iteration == 3` → cap. Append `## Stalled` section. Stop with escalation.
8. Otherwise increment iteration, loop.

## Anti-patterns

- **Don't dispatch the Workflow tool.** It requires explicit user opt-in. `Agent` calls in a single message are the supported parallel-dispatch path.
- **Don't use worktree isolation.** `Agent` doesn't natively support it. The disjoint-touches grouping is the conflict-avoidance contract.
- **Don't relax `npm run check`.** Tests, types, lint, struct, agents, dead-code, docs, spell — every gate exists for a reason. Fix the code or the test correctly. The agent prompt enforces this; the skill enforces it by re-running the check and verifying status afterwards.
- **Don't add new dependencies to "fix" things.** A missing `dependencies` entry means `npm install` was incomplete or `node_modules/` was wiped — not that a new package is needed. The agent prompt forbids this; the skill verifies by checking `git status` on `package.json` after each iteration (if `package.json` changed, raise it as a new warning in the next check).
- **Don't loop past 3 iterations.** Escalate to the user instead.
- **Don't run two `/build-fix` invocations on the same build concurrently.** No locking on `build-check.md` or `build-fix-log.jsonl`; concurrent runs corrupt state.
- **Don't edit `.ridgeline/builds/<name>/state.json`, `phases/`, or other build artifacts.** Those are owned by `ridgeline build`. If they're wrong, the user needs to re-run plan, not have an agent rewrite them.

## Edge cases

- **`build-check.md` is from a stale run** (user already fixed some issues manually): the first re-invocation of `/build-check` after the agents will catch up. No special handling.
- **Iteration 1 returns `ready`** (issues were trivial): success. Print "fixed in 1 iteration".
- **An agent fails or times out**: that group's issues stay unresolved. The next iteration's `/build-check` will surface them. The cap still applies.
- **Group's issues are all in the same file but conflict** (rare — two issues with overlapping suggested edits): handled by sequential within-group order. The agent reads the issues in order and applies them in turn.
- **`npm install` is needed but the agent isn't sure**: the agent prompt grants permission to run it when a missing-dependency blocker is in scope. The skill doesn't run `npm install` itself; only agents do, and only when their assigned issues warrant it.
- **An agent reports `observed` issues not in `build-check.md`**: surface them in the final summary so the user can decide whether to run `/build-check` again. Don't try to add them to the current iteration.
- **`npm run check` exits with code 2 mid-loop** (orchestrator broke between iterations): the next `/build-check` invocation will detect this and write a `check orchestrator failed` blocker. The skill's next-iteration preflight will hit the marker and stop with escalation. The cap protects against infinite retries.

## Critical files for execution

- `/Users/robmclarty/Projects/ridgeline/code/ridgeline/scripts/check.mjs` — the orchestrator that `npm run check` runs; understanding its exit codes and `.check/summary.json` shape is what makes the loop work.
- `/Users/robmclarty/Projects/ridgeline/code/ridgeline/.claude/skills/build-check/SKILL.md` — the check skill this skill calls each iteration.
- `/Users/robmclarty/Projects/ridgeline/code/ridgeline/.ridgeline/builds/fascicle-migration/` — real example to dogfood against.
