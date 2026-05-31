---
name: spec-check
description: Validate that a build's spec.md is ready for the ridgeline planner. Checks required sections, internal consistency, cross-file alignment with constraints/taste/design, and feasibility against the repo. Writes spec-check.md with status ready, needs-attention, or broken. Use when the user runs `/spec-check [build-name]` or asks to validate a build's spec before planning. Run before `ridgeline plan` to catch spec issues that would cause the planner to hallucinate phases.
argument-hint: "[build-name]"
allowed-tools: Read, Write, Glob, Grep, Bash(git status*), Bash(git rev-parse*), Bash(wc *), Bash(date *)
---

# spec-check

Verify that the spec for a given build is ready to be broken into phases by `ridgeline plan`. Writes a verdict file to `.ridgeline/builds/<name>/spec-check.md` and prints the status (`ready` / `needs-attention` / `broken`) to the user.

This skill is **read-only**: it inspects but never modifies `spec.md`, `constraints.md`, `taste.md`, `design.md`, or any repo file. The companion `/spec-fix` skill handles repairs.

## Arguments

`$ARGUMENTS` — one positional arg: the build name (e.g., `fascicle-migration`). No default; fail fast if missing.

## Inputs and preflight

1. **Resolve `BUILD_DIR`.** Set `BUILD_DIR=.ridgeline/builds/$ARGUMENTS`. The working directory is already the repo root; do not `cd`.
2. **Confirm the build dir exists** with Glob on the literal path `.ridgeline/builds/$ARGUMENTS/`. If it doesn't:
   - Glob `.ridgeline/builds/*` to list what does exist.
   - Write a `broken` `spec-check.md` whose only blocker is `[B1] build directory missing` with a suggestion to run `/spec-to-ridgeline` or `ridgeline shape <name>` then `ridgeline spec <name>`.
   - Stop. Do not create the directory.
3. **Confirm `spec.md` exists** inside the build dir. If not, status `broken`, single blocker `[B1] spec.md missing`, suggest `/spec-to-ridgeline`. Stop.
4. **Read** `spec.md`, `constraints.md`, `taste.md` (optional), `design.md` (optional). Note which optional files exist — that affects checks 3 and 6.

## The check.md output format (shared with build-check)

Write to `.ridgeline/builds/$ARGUMENTS/spec-check.md`. Use exactly this shape so `/spec-fix` can parse it:

```markdown
---
status: ready | needs-attention | broken
timestamp: <ISO 8601 UTC>
build: <build-name>
check_kind: spec
iteration: 1
---

# Spec Check — <build-name>

## Summary

<2–3 sentences. Lead with the status verdict. Mention the headline issue if any.>

## Blockers

### [B1] <one-line title>

- **Severity:** blocker
- **Location:** `<file:line>` or `<artifact path>`
- **Evidence:** <verbatim excerpt, ≤5 lines, fenced if multi-line>
- **Suggested fix:** <concrete paragraph; treated as the agent prompt seed by /spec-fix>
- **Touches:** `path/a.md`, `path/b.md`

### [B2] ...

## Warnings

### [W1] <one-line title>

<Same fields as blockers, severity `warning`.>

## Recommendations

### [R1] <one-line title>

<Same fields, severity `recommendation`. Never block any status.>

## What was checked

- [x] spec.md has required H2 sections
- [ ] acceptance criteria are testable (1 vague item flagged as W1)
- [x] cross-file consistency with constraints/taste
- ...

## Raw artifacts

- `.ridgeline/builds/<build-name>/spec.md`
- `.ridgeline/builds/<build-name>/constraints.md`
- `.ridgeline/builds/<build-name>/taste.md`
```

Empty sections read `(none)` — never omit them, because `/spec-fix` parses by H2 heading presence.

**Status mapping is mechanical, not a judgment call:**

- any blocker present → `broken`
- no blockers, ≥1 warning → `needs-attention`
- otherwise → `ready`

**Stable anchors:** every issue gets an ID `[B1]`, `[B2]`, …; warnings `[W1]`, `[W2]`; recommendations `[R1]`, `[R2]`. `/spec-fix` greps `^### \[` to enumerate them.

## The 8 checks

Run all eight, then aggregate into the file. Don't short-circuit on the first blocker — the user needs the full picture.

### 1. Required sections present

`spec.md` should have these H2 headings (per the `spec-to-ridgeline` house style):

- Problem statement (or `## Problem`, `## §1 — Problem`)
- Solution overview (`## Solution`, `## §2 — Solution overview`)
- Interfaces (`## Interfaces`, `## §N — Interfaces`)
- Runtime contract or Semantics
- Failure modes
- Success criteria (or Acceptance criteria)
- File structure (or `## Files`)

Use Grep with `output_mode: content`, pattern `^##\s` to extract all H2s. Match each canonical name fuzzily (case-insensitive, ignoring `§N —` prefixes). Missing canonical sections → one blocker each, citing line 1 of `spec.md` as location.

### 2. Acceptance criteria are testable

Locate the success/acceptance section. For each bullet under it, look for a concrete verb at the start: `returns`, `exits with`, `writes to`, `produces`, `emits`, `accepts`, `rejects`, `creates`, `validates`, `parses`. Bullets that lead with vague language ("works well", "is good", "is fast", "feels right") → warning each.

Cap warnings from this check at 3 — if the spec has more than 3 vague items, emit one rollup `[W?]` "acceptance criteria contain N vague items" and list them all under Evidence.

### 3. Cross-file consistency

Read `constraints.md` (required) and `taste.md` (if present). Detect:

- **Spec restates constraints.** Grep `spec.md` for any verbatim line ≥40 chars that also appears in `constraints.md`. ≥3 such overlaps → warning.
- **Taste/constraints contradictions.** Look for direct opposites: `taste.md` says "prefer X" and `constraints.md` says "no X" or "forbid X" for the same noun (e.g., "class", "default export", "global state"). Found → blocker.
- **Stale references.** `spec.md` says "see constraints.md §N" but no such §N exists. → warning.

### 4. Feasibility against repo

The planner consumes `spec.md` as user-prompt context; missing referents become hallucination fuel. For every claim like "extend identifier", "wrap path", "replace symbol":

- Pattern: Grep `spec.md` for the regex below:

  ```regex
  (extend|wrap|replace|modify)\s+`([^`]+)`
  ```

- For each captured identifier or path, Grep the repo (`src/`, package.json) for it.
- Missing → blocker per identifier. `Location` field cites the line in `spec.md`; `Evidence` shows the spec line plus "(not found in repo)".

Skip identifiers that are obviously third-party (e.g., `npm`, `tsc`, `git`) — heuristic: if the identifier appears in `package.json` dependencies, skip.

### 5. Planner-readiness heuristics

- Count words in `spec.md` (`wc -w`). If >8000 and no `### Phase N` or `## Phase N` headings are present, emit a warning: "spec is long without an author-provided phase breakdown; planner may produce one mega-phase or miss boundaries". `Location` is `spec.md:1`. `Suggested fix` notes the user can add a phase breakdown manually or accept the planner's split.
- Grep `spec.md` for `## Inferred / Gaps`. Count bullets under that heading. If >5, warning: "high inferred-content; planner will commit to guesses". List the inferred items under Evidence.

### 6. `design.md` presence rule

Grep `spec.md` for visual-surface signals: `\b(UI|UX|component|page|screen|render|view|button|form|layout|color|font|palette)\b` (word-boundary, case-insensitive, head_limit 5).

- ≥3 hits AND `design.md` missing → warning "spec describes visual surfaces but `design.md` is missing".
- 0 hits AND `design.md` present → recommendation "`design.md` present for a non-visual project; consider removing if not used".

### 7. Check command exists in constraints

Mirror the regex from `src/stores/inputs.ts:20`:

````regex
/## Check Command\s*\n+```[^\n]*\n([\s\S]*?)```/
````

Read `constraints.md` and apply the pattern (use Grep with `multiline: true` to confirm match, then Read the surrounding lines to extract the command).

- No `## Check Command` section → blocker. The planner's per-phase exit gates depend on this.
- Section present but the fenced block is empty → blocker.

### 8. Open questions still open

Grep `spec.md` for `## Open questions` or `## Open Questions` or `## Inferred / Gaps`. For each non-empty section, list every bullet as one warning each (cap at 5; rollup the rest). These are not blockers — they're visibility prompts — but they downgrade the spec to `needs-attention` if no other warnings or blockers fired.

## Process

1. Run the preflight (resolve `BUILD_DIR`, confirm dir + `spec.md`). On failure, write the minimal `broken` file and stop.
2. Run all 8 checks. Collect findings in memory as `{id, severity, title, location, evidence, suggestedFix, touches[]}`.
3. Compute status mechanically: any blocker → `broken`; no blockers + ≥1 warning → `needs-attention`; otherwise → `ready`.
4. Compose the `spec-check.md` content using the format above. Assign IDs sequentially within each severity (`[B1]`, `[B2]`, …).
5. Write `spec-check.md` with `Write`. Overwrite any existing file (re-running the skill replaces the previous verdict).
6. Print one line to stdout: `spec-check: <status> — N blockers, M warnings, K recommendations. See .ridgeline/builds/<name>/spec-check.md`.

## Edge cases

- **`spec.md` exists but is empty** (zero bytes): single blocker `[B1] spec.md is empty`. Skip checks 1–8.
- **Multiple builds with the same name in different worktrees**: this skill runs in `process.cwd()`; the user invokes it from the worktree they care about. Don't try to coordinate.
- **Cyclical references** (`spec.md §3 references constraints.md §X which references spec.md §3`): not in scope. Treat as ordinary cross-references.
- **`spec.md` uses a non-standard heading style** (e.g., setext `===` underlines): treat as missing — the planner expects ATX `##` headings.
- **Multiple "Check Command" sections in `constraints.md`**: the regex returns the first. Don't warn about duplicates here; that's a constraints.md issue, not a spec issue.

## Anti-patterns

- **Don't fix anything.** This skill is purely diagnostic. The `allowed-tools` whitelist omits `Edit` for repo files; the only `Write` target is `spec-check.md`.
- **Don't soften the verdict.** If a blocker fires, status is `broken` — don't downgrade to `needs-attention` because the issue seems minor.
- **Don't invent issues.** If a heuristic doesn't fire, don't speculate ("the spec might be unclear…"). Verdicts cite concrete evidence or they don't appear.
- **Don't omit empty sections** in the output. `/spec-fix` parses the file structure mechanically — `## Blockers\n(none)` is required for `ready` builds.
- **Don't deduplicate across runs.** Each invocation produces a fresh verdict from a fresh scan; iteration counter is set to `1` unless `/spec-fix` is driving the loop (it will pass the iteration via the file's frontmatter when it re-invokes).
