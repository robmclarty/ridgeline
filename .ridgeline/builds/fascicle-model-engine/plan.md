# Tier 3 — Bring fascicle's providers to ridgeline's core flows

## Context

Tiers 1 + 2 shipped (commits `6386a86`, `46f69af`, `f57ff23`): ridgeline now
delegates model/version resolution to fascicle's `MODEL_FAMILIES`, activates all
seven fascicle providers (env keys + a settings `providers` block), and sets a
deterministic `defaults.provider`. But this only reaches the **engine-backed
flows** — `retrospective`, `retro-refine`, `vision`, `qa` — which call
`engine.generate` via `src/engine/claude.runner.ts`.

The **core flows** — `build`, `plan`/ensemble, `research`, `review`, `refine` —
still spawn the Claude CLI directly through `runClaudeProcess`
(`src/engine/claude-process.ts`), bypassing fascicle's provider resolution
entirely (`builder.ts:140` goes straight to `runClaudeProcess`; `.generate(`
appears nowhere outside `atoms/*` and `claude.runner.ts`). They are Claude-only,
and `ridgeline build` now guards that its model is Claude-resolvable.

**Goal.** Move the core leaf model calls off the spawn path onto fascicle's
engine so any configured provider can drive them, and make the autonomous
builder provider-agnostic. This is the "future phase" the 0.5 migration deferred
(`.ridgeline/builds/fascicle-migration/.ridgeline/learnings.md`: phase 11 was a
lift-and-shift, not a substrate swap).

### The real blocker is the tool surface — not model calls

`runClaudeProcess` does not perform plain completions; it runs **agentic** work
with tools (`Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, `Agent`, `Skill`),
delegated to the Claude CLI's built-ins via `--allowedTools`. fascicle's
`claude_cli` *provider* does the same thing (allowlist delegation), so simply
re-pointing a flow at `engine.generate` on the `claude_cli` provider **gains
nothing** — it is the same subprocess with the same built-in tools.

For a non-Claude provider to do ridgeline's work, those tools must exist as
**in-process fascicle `Tool`s with `execute` closures**, run by fascicle's
in-process tool loop (driven by `max_steps`; note `claude_cli` *ignores*
`max_steps` and rejects multi-turn history, `claude_cli/index.ts:320-327`). So
the foundational deliverable of Tier 3 is a provider-agnostic tool surface, not
the model wiring.

---

## Foundation — a provider-agnostic tool surface (the enabler)

Implement ridgeline's agent toolset as fascicle `Tool`s (or an MCP server) so
fascicle's tool loop can run them under any AI-SDK provider:

- `Read`, `Glob`, `Grep` — read-only filesystem (low risk).
- `Write`, `Edit` — workspace mutation, scoped to the build cwd/worktree.
- `Bash` — **security-critical.** The `execute` closure runs in ridgeline's
  process, *not* inside the Claude CLI's sandbox, so ridgeline must wrap spawned
  commands in greywall itself. Reuse `src/engine/claude/sandbox.policy.ts` +
  `sandbox.ts` to build the sandboxed argv. Do not ship `Bash` for non-Claude
  providers until this is enforced and tested with denial cases.
- `Agent` / `Skill` — subagent + skill dispatch. Hardest to port; may be
  deferred (Claude-CLI-only) in the first cut.

**Decision to make early — in-process Tools vs. an MCP server.** fascicle's tool
loop can call MCP tools, and `claude_cli` already loads ridgeline plugins via
`plugin_dirs`. Exposing the toolset as one MCP server would be reusable across
*both* the CLI and AI-SDK providers and avoids duplicating tool logic. Evaluate
MCP-server-of-tools as the cleanest cross-provider path before committing to
in-process closures.

New code: `src/engine/tools/*.ts` (fascicle `Tool` defs or an MCP server),
sandbox integration via the existing sandbox modules.

---

## 3a — Migrate the single-shot executors to the engine

Lower-risk, bounded tool surfaces; do these before the builder.

- **Targets** (all currently call `runClaudeProcess`): `researcher.ts`,
  `ensemble.ts` (specialists + synthesizer), `reviewer.ts`, `plan-reviewer.ts`,
  `refiner.ts`.
- **The atoms already exist and are dormant** (`src/engine/atoms/`:
  `researcher.atom.ts`, `specialist.atom.ts`, `specialist.verdict.atom.ts`,
  `reviewer.atom.ts`, `planner.atom.ts`, `plan.review.atom.ts`, `refiner.atom.ts`,
  `specifier.atom.ts`) and already call `engine.generate`. Wire the flows to these
  atoms instead of the spawn executors, passing the tool surface + output schema.
- **Extend the bridge.** `runClaudeOneShot` (`claude.runner.ts`) already calls
  `engine.generate`, but it only passes `claude_cli` provider-options
  (`allowed_tools`, `session_id`, `output_json_schema`, `agents`). Extend it to
  pass fascicle `tools` (with `execute`) + `max_steps` so the tool loop runs on
  any provider — not just via the CLI allowlist.
- **Tool needs per executor** (bounded): `reviewer` = Read/Bash/Glob/Grep
  (read-only); `refiner` = Read/Write; `researcher` = Read + network; `planner`/
  `plan-reviewer` = Read. Schema outputs (`ReviewVerdict`, `PlanVerdict`) already
  flow through fascicle's `schema` path.
- **Order:** prove the engine+tools path on the lowest-surface, schema-validated
  executors first (`plan-reviewer`, then `reviewer`), then `refiner`,
  `researcher`, `ensemble`.
- **Preserve:** schema-validated outputs, cost/usage recording (`recordCost`),
  trajectory events, and the golden-output snapshots from the migration's
  phase 12.

---

## 3b — Provider-agnostic autonomous builder

The hard one. Target: `builder.ts`, `builder-loop.ts`, `claude-process.ts`.

- `builder.atom.ts` is the seed (an engine-based single builder turn). Keep
  ridgeline's `runBuilderLoop` orchestration but swap the leaf invocation from
  `runClaudeProcess` to `engine.generate` with the full tool surface +
  `max_steps`.
- **Replicate provider-agnostically** what `runBuilderLoop` owns today:
  continuations (`DEFAULT_MAX_CONTINUATIONS = 5`), per-phase cost caps
  (`DEFAULT_PHASE_COST_CAP_MULTIPLIER`), progress-file handoff
  (`PROGRESS_TRIM_THRESHOLD_TOKENS = 20_000`), git-diff-hash no-progress
  detection, `READY_FOR_REVIEW` wind-down, streaming progress, and sandboxed
  Bash.
- **Continuation mechanics fork.** `claude_cli` continues via `session_id`
  resume and rejects 2+ user messages; AI-SDK providers continue via message
  history. These need different mechanics — likely a provider branch in the
  builder rather than one unified path.
- **Streaming.** `src/ui/claude-stream-display.ts` parses the CLI's
  `stream-json`; for AI-SDK providers it must consume fascicle `StreamChunk` via
  `on_chunk` instead.
- **Dedup decision.** For the Claude case, keep `runClaudeProcess` (the
  subscription path is the harness's reason for being). Add the engine/tool-loop
  path only for AI-SDK providers, selected by the resolved provider. Removing
  `runClaudeProcess` for `claude_cli` is a non-goal.

---

## Sequencing (phases)

1. **Tool surface** — Read/Glob/Grep + sandboxed Bash + Write/Edit as fascicle
   Tools (or an MCP server), with unit tests including sandbox-denial cases.
2. **Bridge extension** — `runClaudeOneShot` passes `tools` + `max_steps`; prove
   it end-to-end on an existing engine-backed flow against a non-Claude provider.
3. **3a executors** — lowest surface first: `plan-reviewer` → `reviewer` →
   `refiner` → `researcher` → `ensemble`.
4. **3b builder** — engine + tool-loop leaf behind a provider branch; keep
   `claude_cli` on `runClaudeProcess`. Lift the `ridgeline build` Claude-model
   guard for providers that pass an end-to-end build.
5. **(Optional)** retire `runClaudeProcess` only if the `claude_cli` path is also
   migrated and proven byte-stable.

---

## Risks & open questions

- **Sandbox parity for in-process Bash** — the biggest correctness/security risk;
  the CLI sandboxed Bash for us, now ridgeline must.
- **Agent quality/cost on non-Claude providers** for autonomous builds is
  unproven; a GPT/Gemini agent will behave differently from Claude Code.
- **`claude_cli` multi-turn limitation** forces divergent continuation logic.
- **Golden-output / trajectory stability** across the substrate swap — the
  migration's phase-12 golden suite + trajectory-event-naming tests are the
  guardrail; keep the `claude_cli` path byte-stable.
- **MCP-server vs. in-process tools** — decide before building the surface.

## Verification

- **Unit:** each tool's `execute` (incl. sandboxed Bash denial cases); the
  extended bridge passes `tools`/`max_steps`.
- **Integration:** run `plan` / `review` / `refine` on `openai` / `google` /
  `openrouter` (engine path) producing valid schema outputs.
- **End-to-end:** a small `build` on a non-Claude provider inside the sandbox;
  confirm phases pass review.
- **Regression:** existing golden-output snapshots + trajectory tests stay green;
  the `claude_cli` path remains byte-stable.

## References (current code)

- Spawn path: `src/engine/claude-process.ts` (`runClaudeProcess`), `builder.ts`,
  `builder-loop.ts`, `ensemble.ts`, `reviewer.ts`, `plan-reviewer.ts`,
  `refiner.ts`, `researcher.ts`.
- Engine bridge: `src/engine/claude.runner.ts` (`runClaudeOneShot`,
  `toClaudeResult`).
- Dormant atom stack: `src/engine/atoms/*.atom.ts`.
- Factory / providers (Tier 1 + 2): `src/engine/engine.factory.ts`.
- Sandbox: `src/engine/claude/sandbox.policy.ts`, `sandbox.ts`.
- Streaming: `src/ui/claude-stream-display.ts`.
- Prior art: `.ridgeline/builds/fascicle-migration/` (phase-12 golden suite;
  `learnings.md` on why phase 11 shipped a lift-and-shift).
