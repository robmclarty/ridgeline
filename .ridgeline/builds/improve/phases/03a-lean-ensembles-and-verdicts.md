---
depends_on: [02-builder-sensors]
---
# Phase 3a: Lean ensembles, structured verdicts, reviewer sensor findings

## Goal

Halve the typical phase cost while preserving depth as an explicit opt-in, make synthesis adaptive when specialists already agree, and flow sensor findings from the builder loop into the reviewer verdict. These three concerns all touch `src/engine/claude/ensemble.exec.ts`, the specialist prompts under `src/agents/specialists/`, and the reviewer's structured-verdict schema — splitting them would churn the same files and trajectory-log schema twice.

When the phase completes: spec/plan/research ensembles default to 2 specialists with one call each; `--thorough` raises to 3 and enables a two-round cross-annotation pass where each specialist sees the round-1 verdicts of the others. `--deep-ensemble` is removed as a named flag but is still accepted with a per-run deprecation line that maps it to `--thorough`. Each specialist emits a fenced JSON skeleton with a stage-specific shape; when all skeletons agree under the normalization rules, the synthesizer is skipped and an audit note is appended to the phase artifact. Malformed JSON always forces synthesis (fail-open). Subprocess timeouts count as failures for quorum, logged with `reason: "timeout"`. The reviewer's structured verdict gains exactly one new field — `sensorFindings: SensorFinding[]` — populated from the adapters shipped in phase 2; the phase artifact renders a "Sensor Findings" section only when non-empty.

Prompt assembly rework (stable-block caching) is deferred to phase 3b to isolate context load on the builder. 3a ships all the ensemble orchestration and verdict-shape changes; 3b layers the CLI-flag and temp-file plumbing for `--append-system-prompt-file` on top of 3a's call path.

## Context

Phase 1a deleted `src/flavours/` and rewired `agent.registry.ts` to `src/agents/` only; phase 1b shipped `src/ui/color.ts`, `runPreflight`, and the `DetectionReport`. Phase 2 shipped `src/sensors/` with the `SensorFinding` interface and integrated sensors into the builder loop; collected findings need to flow into the reviewer here.

The current code path: `src/engine/claude/ensemble.exec.ts` orchestrates specialist calls and synthesizer invocation; `src/engine/claude/claude.exec.ts` already implements SIGTERM→SIGKILL escalation with startup/stall/global timeouts (per spec). Specialist prompts under `src/agents/specialists/` produce prose verdicts today with no structured skeleton.

This phase does NOT touch `src/engine/claude/agent.prompt.ts` or the argv of the Claude CLI subprocess — that is phase 3b's surface. Phase 3a's changes must leave the existing prompt-assembly path intact so phase 3b can rewrite it cleanly.

## Acceptance Criteria

### Default 2-specialist ensembles with `--thorough` opt-in

1. Default invocation produces exactly 2 specialist calls per ensemble stage (spec, plan, research), verified by trajectory-log assertions with a stubbed specialist invoker.
2. `--thorough` produces exactly 3 specialist calls per stage AND enables a two-round cross-annotation pass: in round 2, each specialist receives the round-1 verdicts of the other two specialists as input.
3. Without `--thorough`, no second annotation round runs; exactly one call per specialist per stage.
4. `--deep-ensemble` prints `[deprecated] --deep-ensemble is now --thorough; continuing with --thorough` on stderr (every run, not once per session) and behaves identically to `--thorough` for that run.
5. `--thorough` and `--deep-ensemble` specified together: `--thorough` wins, deprecation notice still printed.
6. `ridgeline --help` documents `--thorough`; `--deep-ensemble` is not listed but is still accepted with the deprecation warning.
7. Quorum behavior preserved: if one of two specialists fails, synthesis runs on one verdict with a warning; if both fail (or all three under `--thorough`), the ensemble halts.
8. Specialist subprocess timeouts count identically to non-zero exits for quorum purposes — any rejection from `invokeClaude` (timeout, non-zero exit, spawn failure) is a "failed specialist" for quorum resolution.
9. Default per-call specialist timeout is 180 s, configurable in `settings.json` via the existing key (recommended range 180–600 s). Timeouts are logged to `trajectory.jsonl` with `reason: "timeout"` and the phase/specialist identifier.
10. A vitest stubs `invokeClaude` to resolve one specialist and time out the other and asserts: (a) synthesis runs on the single survivor with a warning, (b) the timed-out call appears in `trajectory.jsonl` with `reason: "timeout"`, (c) the phase completes with status `done`, not `failed`.

### Structured specialist verdicts with agreement-based synthesis skip

11. Specialist prompts in `src/agents/specialists/` emit a fenced JSON block with stage-specific fields:
    - spec → `{ sectionOutline: string[], riskList: string[] }`
    - plan → `{ phaseList: Array<{ id: string, slug: string }>, depGraph: Array<[string, string]> }`
    - research → `{ findings: string[], openQuestions: string[] }`
12. A parser returns a `SpecialistVerdict` when the JSON block is present and valid; returns `null` otherwise (missing block, malformed JSON, or schema mismatch).
13. Agreement detection compares parsed skeletons field-by-field after normalization (strings trimmed, arrays of primitives sorted), using deep-equal: order-sensitive for `phaseList`; order-insensitive for `sectionOutline`, `riskList`, `findings`, `openQuestions`, and `depGraph`.
14. When all specialists' skeletons agree, the synthesizer is NOT invoked and a line matching `synthesis skipped: N specialists agreed on structured verdict (<stage>)` is appended to the stage's phase artifact (`.ridgeline/builds/*/phases/*.md`).
15. When any specialist's parsed verdict is `null` (malformed output), agreement detection returns false, synthesis runs, and a warning is logged.
16. When prose diverges but skeletons match, synthesis is still skipped (agreement is defined on skeletons, not prose).
17. Agreement detection is always-on at default; there is no flag to disable it.
18. When synthesis is skipped, the first specialist's prose artifact becomes the canonical stage artifact, and the audit note is appended after the prose.
19. A vitest covers: agreeing verdicts → skip + audit note; disagreeing → synthesis; malformed → synthesis + warning; three agreeing under `--thorough` → skip.

### Reviewer sensor findings

20. The reviewer's structured verdict gains exactly one new field — `sensorFindings: SensorFinding[]` — with no other schema changes. When no sensors ran, `sensorFindings` is `[]` (not `undefined`).
21. The phase artifact markdown includes a "Sensor Findings" section with one bullet per finding when the array is non-empty; when empty, the section is omitted (no empty heading).
22. Sensor findings collected during the builder loop (phase 2) flow into this field; a vitest asserts that a stubbed sensor producing one warning finding appears as a single bullet in the rendered phase artifact.

### Tests

23. Vitests cover: default-2 count; `--thorough` count=3 + annotation payload contents (each round-2 specialist input contains the other two's round-1 verdicts); `--deep-ensemble` deprecation wording on stderr; quorum fallback with one specialist; halt with zero specialists; timeout-as-failure quorum resolution.
24. Vitests cover: structured-verdict agreement skip with audit note; disagreement synthesis; malformed JSON → synthesis + warning; three-way agreement under `--thorough` → skip.
25. A vitest covers reviewer `sensorFindings` rendering: empty array → no "Sensor Findings" section; non-empty → one bullet per finding.

### Check command

26. The check command from `constraints.md` (`npm run lint && npm test && npx tsc --noEmit`) exits 0 at the end of this phase.

## Spec Reference

Drawn from `spec.md`:

- **Default 2-specialist ensembles with `--thorough` opt-in** (entire section)
- **Structured specialist verdicts with agreement-based synthesis skip** (entire section)
- **Vitest coverage for new code paths** — items (d), (e)

Drawn from `taste.md`:

- Code Style (fail-open on parse errors for structured verdicts; always-on over opt-in; no silent fallbacks for removed functionality)
