# Build Learnings

## Build: helloworld (2026-05-08)

### Build Defects
- None observed. Both builder and reviewer ran under the `greywall` sandbox without tool failures, fallbacks, or skipped acceptance criteria. The reviewer verified all 15 acceptance criteria via byte-level checks (`node hello.js` → exactly `Hello, world!\n`, 14 bytes, exit 0; `require('./hello')` produces no load-time output).

### What Worked
- Single-phase plan matched the trivial scope — no over-decomposition of a 14-line module.
- Builder produced a passing artifact in one invocation (`ready_for_review`, no retries) with a clean reviewer verdict.
- Acceptance criteria were verifiable mechanically (byte counts, exit codes, `require.main` guard), which gave the reviewer an unambiguous pass/fail.
- Plan reviewer approved on first attempt after specialist+synthesizer round.

### What Didn't
- Plan stage burned ~$0.92 of specialist+synthesizer cost (3 specialists × 2 attempts each + 2 synthesizer attempts) for a module with one exported function. The synthesizer's second attempt produced only 17–18 output tokens — likely a no-op confirmation pass — yet still cost $0.10–$0.11 each time due to cache-creation tokens.
- The 2026-04-02 run completed the same task as `01-hello-script` for $0.44 total; the 2026-05-08 run cost $2.67 for an equivalent `01-hello-module`. ~6× cost increase for the same deliverable.
- One earlier plan attempt failed three specialists simultaneously with "malformed JSON output" (2026-05-08T01:37:21) — the spec stage produced unparseable specialist responses and aborted before planning.

### Patterns to Repeat
- Acceptance criteria phrased as byte-exact / exit-code-exact assertions (`exactly 'Hello, world!\n'`, `exit 0`, `14 bytes`) — leaves no reviewer ambiguity.
- Constraints check command that exits 0/non-0 as a binary gate alongside acceptance criteria.
- Single-phase decomposition for trivially-scoped builds.

### Patterns to Avoid
- Running the full specialist + synthesizer plan-review pipeline on a one-file, one-function build. The plan-stage overhead ($1.18) exceeded the actual builder+reviewer work ($0.57) on the 2026-05-08 run.
- Synthesizer second-attempt pattern that emits ~17 tokens but pays full cache-creation cost — looks like a confirmation/no-op pass that should be short-circuited or skipped when attempt 0 already produced a complete plan.

### Cost Analysis
- **Total across both runs in this build directory:** $3.75 (trajectory shows two complete plan→build→review cycles plus one aborted spec stage).
- **2026-05-08 run alone:** ~$2.67 — plan $1.18 (44%), builder $0.30 (11%), reviewer $0.26 (10%), prior specialist/synthesizer scaffolding $0.92.
- **Most expensive single entry:** plan synthesizer attempt 0 at $0.28 (2783 output tokens, 51.5s).
- **Efficiency observation:** builder and reviewer were efficient (sub-50s each, sub-$0.31 each). The plan stage is the cost driver and is disproportionate to phase complexity.
- Total wall-clock for 2026-05-08 plan→build→review: ~3m 49s.

### Recommendations for Next Build
- Add a complexity heuristic to the planner that bypasses or shortens the specialist+synthesizer review when the spec yields a single phase with <5 acceptance criteria — current overhead doesn't pay for itself on trivial builds.
- Investigate the synthesizer attempt-1 pattern (17 output tokens, $0.10+ cost from cache-creation). If attempt 0 is already approved, attempt 1 should be skipped, not re-run.
- Investigate the 2026-05-08T01:37:21 "malformed JSON output" failure across all three spec specialists simultaneously — a shared parse path or prompt format issue, not three independent failures.
- For builds at this scope, reuse the 2026-04-02 spec/constraints structure verbatim — it produced an equivalent passing artifact at 1/6 the cost without the specialist scaffolding.
