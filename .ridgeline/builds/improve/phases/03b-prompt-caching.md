---
depends_on: [03a-lean-ensembles-and-verdicts]
---
# Phase 3b: Prompt caching of stable stage inputs

## Goal

Reshape prompt assembly so per-invocation caching hygiene is correct and token usage is observable. The stable block (`constraints.md → taste.md if present → spec.md`) is written to a per-invocation temp file passed via the Claude CLI's `--append-system-prompt-file`, alongside `--exclude-dynamic-system-prompt-sections` so per-machine sections don't poison the shared prefix. Cache invalidation is delegated to the upstream content-hash; ridgeline persists no client-side cache key. Token counters from `--output-format json` (`cache_creation_input_tokens`, `cache_read_input_tokens`) are extracted and logged to `trajectory.jsonl` so the "caching is working" claim is measurable.

This phase is deliberately isolated from phase 3a's ensemble/verdict changes so the builder's context window stays focused on prompt-assembly and CLI-flag plumbing. 3a's call path is the substrate this phase rewrites: the specialist and synthesizer invocations now assemble their system prompts from the stable file rather than in-process concatenation.

## Context

Phase 3a shipped lean ensembles (default 2, `--thorough` → 3 + cross-annotation), structured specialist verdicts with agreement-based synthesis skip, and reviewer `sensorFindings`. The trajectory-log schema already carries `reason: "timeout"` records from 3a; this phase adds cache token counters and a `prompt_stable_hash` event.

The current code path: `src/engine/claude/agent.prompt.ts` assembles the prompt the Claude CLI subprocess receives; `src/engine/claude/claude.exec.ts` spawns the subprocess with existing SIGTERM→SIGKILL escalation and timeout handling. Specialist and synthesizer paths (updated in 3a) both call through `agent.prompt.ts`.

This phase does NOT attempt cross-invocation prompt-cache reuse — the Claude Code CLI emits a per-spawn dynamic header (`cc_version=…;cch=…;`) that busts the server-side prefix cache between invocations. Within a single invocation, the rewrite still improves ordering hygiene and enables `cache_read_input_tokens` to be non-zero across intra-run tool turns. Cross-spawn reuse via `--resume` or persistent subprocess is out of scope (Future Considerations).

## Acceptance Criteria

### Prompt caching of stable stage inputs

1. `src/engine/claude/agent.prompt.ts` exposes a `buildStablePrompt(parts)` function whose output orders sections exactly as: `constraints.md → taste.md (if present) → spec.md` — verified by a vitest snapshot. The core agent system prompt (from `src/agents/core/*.md`) is passed separately via `--system-prompt` / `--append-system-prompt` and is not merged into the stable block.
2. The stable block is written to a per-invocation temp file (e.g. `os.tmpdir()/ridgeline-stable-<sha256>.md`) and passed to the Claude CLI via `--append-system-prompt-file <path>`; the file is cleaned up on process exit.
3. The argv of the spawned Claude CLI subprocess contains `--append-system-prompt-file` and `--exclude-dynamic-system-prompt-sections` when running `-p` invocations — verified by a vitest stub.
4. Availability of `--exclude-dynamic-system-prompt-sections` is detected once at startup by parsing `claude --help`; if the flag is absent, the caching code path is a no-op (no error, no flag passed) and a single `info`-level line is logged to `trajectory.jsonl` with `reason: "cli_flag_unavailable"`.
5. Given identical `constraints.md`, `taste.md`, and `spec.md` contents across two consecutive invocations, the stable temp file bytes are byte-identical across runs (assertion is on file contents, not on an in-process assembled string).
6. If `taste.md` is absent, the stable block still assembles in the specified order with `taste.md` omitted (no placeholder) — verified by vitest.
7. Cache invalidation on content change is delegated to the upstream API's content-hash; no `.ridgeline/cache-key.json` or mtime-tracking file is written by ridgeline.
8. Volatile content (per-phase handoff, current task) is passed on stdin or as the non-cached `-p` prompt argument — never merged into the stable file. A vitest mutates the handoff across runs and asserts the stable-file sha256 is unchanged.
9. A local `sha256` of the concatenated stable files is logged to `trajectory.jsonl` under event type `prompt_stable_hash` for diagnostics only.
10. With `--output-format json`, the Claude CLI emits `cache_creation_input_tokens` and `cache_read_input_tokens` per response; both are extracted and logged to `trajectory.jsonl` under the existing phase event.
11. When the combined stable block is under the model's minimum cacheable prefix (4,096 tokens for Opus 4.5/4.6/4.7 and Haiku 4.5; 2,048 for Sonnet 4.6), preflight (from phase 1b) prints a `warning`-level line noting the threshold was not met and caching will be silently skipped upstream. The check uses the same token count the `-p` invocation will see.
12. No caching-specific flag is exposed on the CLI — always-on when available; preserved across 0.8.0.

### Tests

13. Vitests cover: prompt assembly order snapshot; absent-`taste.md` order; argv contains `--append-system-prompt-file` and `--exclude-dynamic-system-prompt-sections`; CLI flag absent → no-op + `cli_flag_unavailable` log; identical inputs → byte-identical stable file; volatile content does not leak into the stable file; `prompt_stable_hash` event present in trajectory.

### Check command

14. The check command from `constraints.md` (`npm run lint && npm test && npx tsc --noEmit`) exits 0 at the end of this phase.

## Spec Reference

Drawn from `spec.md`:

- **Prompt caching of stable stage inputs** (entire section, including the note about CLI per-spawn header busting cross-invocation cache)
- **Vitest coverage for new code paths** — item (g)

Drawn from `taste.md`:

- Code Style (always-on over opt-in; no silent fallbacks for removed functionality)
