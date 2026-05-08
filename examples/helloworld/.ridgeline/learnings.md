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


## Build: helloworld (2026-05-08)

### Build Defects
- None observed. The single phase produced `hello.js` and `package.json` matching the spec; reviewer performed byte-level verification (`Hello, world!\n`, 14 bytes, exit 0, no stderr, zero output on require) rather than accepting a generic "looks fine" pass. No tool failures, no fallbacks, no skipped acceptance criteria.

### What Worked
- Clean single-shot build: phase `01-hello-module` passed on builder attempt 1 / reviewer attempt 1 with zero retries.
- The reviewer used concrete byte-level checks (14-byte stdout, exit code, stderr emptiness, load-time silence) instead of paraphrasing the spec — this is exactly the verification rigor that makes a "pass" trustworthy.
- Plan reviewer was invoked and approved on the first synthesizer pass (the second synthesizer attempt was a near-zero-token confirmation, 17 output tokens), so the plan stage converged efficiently once the spec was in hand.
- Spec stage produced 15 acceptance criteria for what is fundamentally a 14-line module — granular enough that "passed" actually meant something.

### What Didn't
- **Spec stage failed entirely on the first run at 01:37:21Z**: all three specialists (clarity, completeness, pragmatism) returned `malformed JSON output` simultaneously. This is a parser/protocol failure, not a content failure — three independent specialists do not all produce malformed JSON by coincidence. Worth investigating whether the spec-stage specialist prompt or output schema regressed.
- The build re-ran the entire plan stage from scratch at 02:16:18Z (~34 min after the first plan completed at 01:44:16Z), spending another **$1.18 on planning** for the same `01-hello-module` phase. Whether this was a deliberate re-plan or an accidental restart isn't recorded in trajectory.jsonl — there's no event explaining why plan ran twice.
- Plan synthesizer attempt 1 in both runs produced only 17–18 output tokens for ~$0.11 each — likely a "no changes" confirmation pass, but at $0.11/pass it's not free. Worth checking whether the second synthesizer attempt is load-bearing.

### Patterns to Repeat
- **Byte-exact acceptance criteria for I/O-shaped tasks**: "writes exactly `Hello, world!\n` (14 bytes) to stdout, nothing to stderr, exit 0" is verifiable in one `node hello.js | wc -c` command. Carry this phrasing style into other CLI/script specs.
- **Explicit no-side-effects-on-import criterion**: spec required `require('./hello')` to produce zero output, and reviewer verified it. This catches a class of bug (top-level side effects) that "the function works" criteria miss.
- **Plan reviewer in the loop**: the `plan_complete` event shows `verdict: approved` from a plan reviewer before phase generation. Keep this — it caught nothing here, but on a larger spec it's the cheapest place to catch scope drift.

### Patterns to Avoid
- **Silently re-running the plan stage**: if plan ran twice on purpose, the trajectory should record why (spec edit? user re-invocation?). If it ran twice by accident, the harness should refuse to re-plan a build that already has an approved plan and a passed phase. Either way, $1.18 of duplicated planning on a hello-world build is a smell.
- **Specialist failures with no retry/fallback**: three `specialist_fail` events with `reason: error` and no subsequent retry on the same date. The harness apparently abandoned the spec stage rather than retrying with a stricter JSON-output reminder. For non-determinism in JSON formatting, one retry is cheap insurance.

### Cost Analysis
- **Total cost: $3.75** across the full lifecycle (one April plan+build+review at $0.44, one May plan+build+review at $1.07, one May re-plan+build+review at $2.24).
- **Most expensive role: planning specialists + synthesizers**, totaling **~$1.97** (53% of total spend) for a 14-line module. Each plan run cost ~$1.18 — more than the build and review combined ($0.30 + $0.26 = $0.56).
- **Cheapest stage: the build itself.** Builder spent $0.30 to write 14 lines of code in one shot. The economics here are inverted: planning a hello-world cost 4× what building it cost.
- Cache hit rates are healthy (builder read 201k cached tokens vs 18k created on the second May run), so the cost driver isn't cache misses — it's the multi-specialist plan fan-out running on a task that doesn't need three specialists.

### Recommendations for Next Build
- **Add a "plan complexity floor"**: for specs with one phase and <50 lines of expected output, skip the three-specialist + synthesizer fan-out and run a single planner. The current pipeline spent $1.18 to plan a file that the builder wrote in $0.30.
- **Investigate the 01:37:21Z specialist JSON failures**: pull the raw specialist output from that run (if retained) and check whether it's a prompt regression, a schema-parsing bug, or model nondeterminism. Three simultaneous failures across distinct specialist roles points at a shared upstream cause.
- **Record a reason on plan re-runs**: add a `plan_restart` trajectory event with a reason field (`spec_changed`, `user_requested`, `prior_plan_invalidated`) so retrospectives can tell deliberate re-plans apart from accidental ones.
- **Audit the 17-token synthesizer attempt 1**: if it's a "no-op confirmation" pass, gate it behind a diff check — only run it when synthesizer attempt 0 produced changes that need re-validation.
