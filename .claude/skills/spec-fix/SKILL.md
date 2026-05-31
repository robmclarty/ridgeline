---
name: spec-fix
description: Read a build's spec-check.md and fix the spec/constraints/taste/design files so the spec is ready for the ridgeline planner. Plans fixes, dispatches one or more fix agents, re-runs `/spec-check`, and loops until the status reaches ready or a 3-iteration cap is hit. Use when the user runs `/spec-fix [build-name]` or asks to repair a build's spec after `/spec-check` flagged issues.
argument-hint: "[build-name]"
allowed-tools: Read, Write, Edit, Glob, Grep, Task, Skill
---

# spec-fix

Read the verdict produced by `/spec-check`, plan repairs, dispatch one or more subagents to apply them, re-run `/spec-check`, and loop until the spec reaches `ready`. The skill stops on success, on a hard 3-iteration cap, or when the verdict carries a "requires human judgment" marker (see below).

The skill **writes to `spec.md`, `constraints.md`, `taste.md`, and `design.md`** via dispatched agents. It does not touch source code in `src/` — those are the build-fix domain.

## Arguments

`$ARGUMENTS` — one positional arg: the build name. No default; fail fast if missing.

## Inputs and preflight

1. **Resolve `BUILD_DIR=.ridgeline/builds/$ARGUMENTS`.** Working directory is the repo root.
2. **Read `BUILD_DIR/spec-check.md`.** If missing:
   - Print: `spec-check.md missing — run /spec-check $ARGUMENTS first`.
   - Stop. Do not run `/spec-check` from here implicitly; the user runs it explicitly so they see the initial verdict.
3. **Parse the frontmatter `status` field.**
   - `ready` → print "spec-check status is `ready` — nothing to fix" and stop.
   - `needs-attention` or `broken` → continue.
4. **Refuse if the verdict requires human judgment.** Grep `spec-check.md` for the literal phrase `requires human judgment` (anywhere in a `Suggested fix:` line). Found → print the marker blocker's title, location, and evidence verbatim, then stop. These spec issues need a real conversation with the user; agents will only make them worse.

## Parsing the check.md

Use Grep with `output_mode: content` and pattern `^### \[` on `spec-check.md` to enumerate all H3 issue headings under `## Blockers`, `## Warnings`, and `## Recommendations`. For each match:

- Extract the ID (`[B1]`, `[W1]`, etc.) from the line.
- Read the block (Read with offset around the match, until the next H3 or H2).
- Parse the bulleted fields:
  - `Severity:` → use to classify; only blockers and warnings get fixed (recommendations are advisory).
  - `Location:` → file/line for the agent's context.
  - `Evidence:` → verbatim text for the agent's context.
  - `Suggested fix:` → seed for the agent's prompt.
  - `Touches:` → comma-separated list of file paths the fix will modify.

Build an in-memory list `issues = [{id, severity, title, location, evidence, suggestedFix, touches[]}, ...]`. Skip recommendations.

## Grouping for parallelism

Two issues are in the same group if their `touches[]` sets intersect (treat empty `touches[]` as `["spec.md"]` since spec issues default to spec.md). Compute the groups with simple union-find on the touches sets.

For spec-fix, most issues touch `spec.md` alone → typically one sequential group. The exception is when an issue touches only `taste.md` or only `design.md` while others touch only `spec.md` → those can run in parallel.

## Dispatching fix agents

For each group:

- Use the subagent-dispatch tool (Task) with `subagent_type: general-purpose`.
- All agent calls for the iteration go in **one message** (parallel dispatch).
- Each agent's prompt:

  ```text
  You're fixing ridgeline spec issues for build [name]. The verdict comes from /spec-check.

  Files in scope: <touches list, joined>.
  Working directory: <repo root path>.

  Issues to fix (verbatim from spec-check.md):

  <paste each issue's H3 block here — title, severity, location, evidence, suggested fix, touches>

  Constraints:
  - Edit only the files listed in "Files in scope". Do not touch src/ or any other repo files.
  - Do not soften acceptance criteria to avoid the warning — make them concrete and testable.
  - Do not delete entire sections to silence a check — restructure or expand instead.
  - If an issue genuinely requires user judgment (ambiguous direction, missing information you can't infer), do NOT guess. Return the issue IDs you skipped with a one-line reason each.

  Report (in your final message):
  - IDs you resolved.
  - IDs you skipped, with reason.
  - File diffs are implicit from your edits — no need to repeat them.
  ```

After all agents return, collect the reported `resolved` and `skipped` ID sets across groups.

## Re-running the check

Invoke the `/spec-check` skill via the Skill tool with `args: $ARGUMENTS`. This regenerates `spec-check.md` with a fresh verdict. After it returns, re-read `spec-check.md` and parse the new `status`.

## Loop

```text
iteration = 1
while iteration <= 3:
  parse issues from spec-check.md
  if status == ready: stop with success
  if status had requires-human marker: stop with escalation
  group issues by disjoint touches
  dispatch agents (parallel across groups)
  re-invoke /spec-check
  iteration += 1
on cap: append a "## Stalled" section to spec-check.md and stop
```

The 3-iteration cap is hard. On cap, append (do not overwrite) a `## Stalled` section at the end of `spec-check.md` listing each surviving blocker/warning ID and a one-line "agents tried 3 times; here's the residual error" note quoting the issue's title. Print a clear "stalled — N issues remain" line to the user. Do NOT re-dispatch.

## Transcript

Append one line per iteration to `BUILD_DIR/spec-fix-log.jsonl`:

```json
{"iteration":1,"timestamp":"...","ids_attempted":["B1","B2","W1"],"ids_resolved":["B1","B2"],"ids_skipped":[],"status_after":"needs-attention"}
```

Use `Edit` if the file exists (append a new line), `Write` to create it. The log is transcript-only; re-running the skill starts fresh from iteration 1.

## Process

1. Preflight: resolve `BUILD_DIR`, read `spec-check.md`, check status and human-judgment marker. Stop early on `ready` or the marker.
2. Initialize `iteration = 1`. Begin the loop.
3. Parse issues, group, dispatch agents in parallel.
4. Append the iteration row to `spec-fix-log.jsonl`.
5. Invoke `/spec-check` via Skill. Re-read `spec-check.md`.
6. If `status == ready` → success. Print summary: "spec-fix: ready — fixed N issues across M iterations" and stop.
7. If `iteration == 3` → cap. Append `## Stalled` section and stop with escalation.
8. Otherwise increment iteration, loop.

## Anti-patterns

- **Don't silently skip an issue.** If the agent reports `skipped` with a reason, surface that to the user in the final summary verbatim.
- **Don't dispatch the Workflow tool.** Workflow requires explicit user opt-in. `Agent` calls in a single message are the supported parallel-dispatch path for skills.
- **Don't use worktree isolation.** `Agent` doesn't natively support it. The disjoint-touches grouping is the conflict-avoidance contract.
- **Don't relax `/spec-check`.** If the agent claims an issue is "actually fine", that's the agent's call — it edits the spec to address the check, or it skips. No third option.
- **Don't loop past 3 iterations.** The cap exists to keep stalled fixes from burning context indefinitely. Escalate.
- **Don't run two `/spec-fix` invocations on the same build concurrently.** There's no locking on `spec-fix-log.jsonl` or on `spec-check.md`; concurrent runs corrupt the iteration counter and may dispatch redundant agents.
- **Don't edit `state.json`, `phases/`, or anything outside the spec/constraints/taste/design files.** That's outside the scope of fixing the spec.

## Edge cases

- **`spec-check.md` is from a stale `/spec-check` run** (e.g., user edited the spec between the check and the fix): the agents will fix issues that may already be resolved. The re-invoked `/spec-check` will catch up — no special handling needed.
- **Iteration 1 already returns `ready`** (no fix actually needed once the agents finished): success. Print "fixed in 1 iteration".
- **An agent fails or times out**: that group's issues stay unresolved. The next iteration's `/spec-check` will surface them again. The cap still applies.
- **The agent edits a file that wasn't in `Touches`**: not enforceable from the skill side; the agent prompt explicitly forbids it, but if it happens, the next `/spec-check` may surface new issues. The cap protects against runaway agents.
- **`design.md` doesn't exist but an issue says "create `design.md`"**: the agent creates it via Write. The `touches[]` field for that issue should already say `design.md`.
