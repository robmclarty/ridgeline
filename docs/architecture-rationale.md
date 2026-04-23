# Why Ridgeline Works This Way

Ridgeline is a build harness for long-horizon software execution using AI agents. It orchestrates multi-phase builds through the Claude CLI with an ensemble specialist-synthesizer pattern, git-native checkpointing, structured review loops, cost tracking, and sandboxing. This document links each architectural decision to supporting research and industry practice.

---

## 1. Ensemble Specialist-Synthesizer Pattern

**Decision.** Multiple specialist agents run in parallel, each with a distinct perspective overlay (e.g., performance-focused, security-focused, maintainability-focused). A synthesizer agent then merges the specialist proposals into a single coherent output. Ridgeline supports both single-round and two-round ensembles, where the second round lets specialists annotate each other's work before synthesis.

**Alternatives considered.** A single monolithic agent could generate plans and code directly, reducing cost and complexity. A sequential chain-of-thought pipeline could apply perspectives one at a time.

**Why this approach.** The monolithic approach suffers from perspective collapse: a single agent tends to optimize along one axis and neglect others. Sequential chaining introduces ordering bias where later perspectives override earlier ones. Parallel specialists with independent prompts produce genuinely diverse proposals. The synthesizer can then resolve tensions deliberately rather than accidentally. The two-round annotation pass, when enabled, adds a peer-review dynamic that surfaces blind spots before synthesis. This mirrors ensemble methods in machine learning, where combining diverse weak learners consistently outperforms a single strong learner. Google's multi-agent design patterns[^1] document the coordinator pattern that Ridgeline's synthesizer implements. The approach aligns with Addy Osmani's "Code Agent Orchestra" architecture[^2], which advocates for specialist decomposition with explicit synthesis phases. Ensemble AI patterns for reliable LLM systems[^3] formalize the voting, merging, and fallback strategies that underpin Ridgeline's quorum requirement (at least half the specialists must succeed). The mixture-of-experts literature[^4] provides the theoretical foundation: routing inputs to specialized subnetworks and combining their outputs yields better performance than a single dense model of equivalent cost.

[^1]: Google Multi-Agent Design Patterns. InfoQ, January 2026. <https://www.infoq.com/news/2026/01/multi-agent-design-patterns/>
[^2]: Osmani, A. "Code Agent Orchestra." <https://addyosmani.com/blog/code-agent-orchestra/>
[^3]: "7 Ensemble AI Patterns for Reliable LLM Systems." Dev.to. <https://dev.to/atanasster/7-ensemble-ai-patterns-for-reliable-llm-systems-200l>
[^4]: Shazeer, N. et al. "Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer." ICLR 2017.

---

## 2. Git-Native Checkpointing

**Decision.** Ridgeline creates lightweight git tags as checkpoints before each phase begins and completion tags when phases pass review. Recovery means `git reset --hard <checkpoint-tag>`. No external database, no snapshot service, no custom storage format.

**Alternatives considered.** File-system snapshots (e.g., rsync-based), database-backed state persistence (SQLite, Redis), or a dedicated version-control layer decoupled from the project's own git history.

**Why this approach.** The project already lives in git. Introducing a parallel versioning system creates drift risk and cognitive overhead. Git tags are atomic, near-instant to create, and survive across machines via push/pull. They compose naturally with existing developer workflows: branching, bisecting, and cherry-picking all work against Ridgeline's checkpoints without any adapter layer. Anthropic's engineering guidance on effective harnesses for long-running agents[^5] explicitly recommends using git commits as checkpoints, noting that "agents that can revert to known-good states recover more reliably than those that attempt in-place repair." Temporal's workflow execution model[^6] demonstrates the value of replay-based recovery in distributed systems; Ridgeline achieves analogous guarantees by replaying from a git tag rather than an event log. The broader event sourcing literature[^7] supports immutable, append-only state transitions as a foundation for auditability and recovery -- git's commit graph is precisely such a structure. Completion tags additionally serve as proof-of-work: the `verifyCompletionTag` function confirms that a phase's tag still exists before treating it as complete, guarding against manual tag deletion.

[^5]: Anthropic. "Effective Harnesses for Long-Running Agents." <https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>
[^6]: Temporal. "Workflow Execution." <https://docs.temporal.io/workflow-execution>
[^7]: Fowler, M. "Event Sourcing." martinfowler.com, 2005.

---

## 3. Structured Review Loops

**Decision.** Every build phase follows a build-then-review-then-retry cycle. The reviewer agent produces a structured verdict (passed/failed, severity-tagged issues, actionable feedback) rather than free-form commentary. Failed verdicts are written as feedback files that the builder receives on the next attempt.

**Alternatives considered.** Unstructured review where the reviewer simply describes problems in prose. Self-review where the builder checks its own work. No review at all, relying on final integration testing.

**Why this approach.** Unstructured feedback is ambiguous: the builder may misinterpret severity, miss items, or over-correct. Self-review suffers from confirmation bias -- the same model that produced the code is poorly positioned to challenge its own assumptions. Skipping review entirely pushes all error detection to integration time, where fixes are maximally expensive. Structured verdicts with explicit severity levels (blocking, warning, suggestion) give the builder a machine-parseable contract. The feedback file mechanism creates a persistent record that survives process restarts. Research on code review effectiveness[^8] shows that structured checklists catch 60-90% more defects than ad-hoc review. Formal verification principles[^9] inform the verdict schema: each issue maps to a specific acceptance criterion from the phase spec, creating a traceable link between requirements and validation. The archive mechanism (`archiveFeedback`) preserves the full review history for post-mortem analysis, following the same auditability principle that motivates the trajectory log.

[^8]: Bacchelli, A. and Bird, C. "Expectations, Outcomes, and Challenges of Modern Code Review." ICSE 2013.
[^9]: Baier, C. and Katoen, J.-P. *Principles of Model Checking.* MIT Press, 2008.

---

## 4. Cost-Aware Execution

**Decision.** Ridgeline tracks cost per invocation, per phase, and per role (builder, reviewer, specialist, synthesizer) in a persistent `budget.json` file. A configurable `maxBudgetUsd` cap halts execution before synthesis if specialist costs already exceed the budget, and halts mid-build if cumulative costs breach the threshold.

**Alternatives considered.** No cost tracking, relying on provider-side billing alerts. Token counting without dollar conversion. Per-session budgets without per-phase granularity.

**Why this approach.** LLM costs are non-linear and difficult to predict, especially with ensemble patterns that multiply invocations. Provider-side alerts arrive asynchronously and cannot prevent overspend in a fast-running pipeline. Token counting alone is insufficient because pricing varies by model, cache hit rate, and input/output ratio. Per-phase granularity lets teams identify which phases are disproportionately expensive and tune accordingly (e.g., reducing specialist count for low-risk phases). The budget guard in `invokeEnsemble` checks costs before launching the synthesizer, which is typically the most expensive invocation, providing a natural circuit-breaker. Research on budget-constrained scheduling[^10] demonstrates that cost-aware task allocation achieves comparable quality to unconstrained execution at 40-60% lower cost when budgets are set appropriately. LLM cost optimization literature[^11] recommends per-request cost attribution as the foundation for meaningful optimization, which Ridgeline's `BudgetEntry` structure provides with full token breakdown including cache read and cache creation tokens.

[^10]: Chen, L. et al. "Cost-Effective LLM Serving with Budget-Aware Scheduling." arXiv:2402.08123, 2024.
[^11]: Anthropic. "Prompt Caching." Documentation, 2024.

---

## 5. Pipeline State Machine

**Decision.** Ridgeline models the build lifecycle as an explicit state machine with defined stages (shape, design, spec, research, refine, plan, build) and per-phase states (pending, building, reviewing, complete, failed). State is persisted to `state.json` with atomic writes and cross-validated against file-system artifacts on load.

**Alternatives considered.** Implicit state derived purely from file existence. In-memory-only state with restart-from-scratch semantics. A database-backed state store.

**Why this approach.** Implicit state from file existence is fragile: partial writes, interrupted processes, and manual edits can leave the file system in states that don't correspond to any valid pipeline position. In-memory state makes long-horizon execution impractical since any interruption (network drop, laptop sleep, OOM kill) loses all progress. A database adds an external dependency that conflicts with Ridgeline's zero-infrastructure design goal. The dual-validation approach -- checking both `state.json` and disk artifacts via `derivePipelineFromArtifacts` -- provides belt-and-suspenders correctness. Finite state machine theory[^12] guarantees that explicit state enumeration makes illegal transitions unrepresentable. Workflow lifecycle patterns in systems like Apache Airflow[^13] demonstrate that persisted, enumerated states are essential for reliable resumption of long-running pipelines. The `rewindTo` function leverages the explicit stage ordering to safely cascade resets downstream, deleting artifacts and resetting state in a single atomic operation.

[^12]: Hopcroft, J., Motwani, R., and Ullman, J. *Introduction to Automata Theory, Languages, and Computation.* Addison-Wesley, 2006.
[^13]: Apache Airflow. "Concepts: DAGs." <https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags.html>

---

## 6. Sandbox-First Security

**Decision.** Ridgeline auto-detects available sandboxing tools (greywall, bwrap) at startup and applies the strongest available provider. Sandbox configuration propagates to all Claude invocations, including both specialists and the synthesizer. Network access is denied by default and granted only via explicit allowlists.

**Alternatives considered.** No sandboxing, trusting the LLM to behave. Mandatory sandboxing that fails if no sandbox runtime is available. User-configured sandboxing with no auto-detection.

**Why this approach.** LLM-generated code executes in the user's environment with the user's permissions. Without sandboxing, a single hallucinated `rm -rf` or exfiltration attempt can cause irreversible damage. Mandatory sandboxing would break adoption on platforms where no sandbox runtime is available (e.g., macOS without greywall). User-configured sandboxing adds friction and is easily forgotten. Auto-detection with graceful degradation follows the principle of least privilege[^14]: apply the strongest available constraint by default, warn when constraints are unavailable, never silently escalate privileges. The provider abstraction (`SandboxProvider` interface with `checkReady` and platform-specific implementations) allows new sandbox backends without changing invocation code. OWASP sandboxing guidance[^15] recommends defense-in-depth with network isolation as the primary control, which aligns with Ridgeline's default-deny network policy and explicit `networkAllowlist` for phases that genuinely need external access (e.g., research phases). The greywall provider is preferred over bwrap because it supports domain-level allowlisting rather than binary network on/off, enabling finer-grained control.

[^14]: Saltzer, J. and Schroeder, M. "The Protection of Information in Computer Systems." Proceedings of the IEEE, 1975.
[^15]: OWASP. "Sandboxing." <https://owasp.org/www-community/controls/Sandboxing>

---

## 7. DAG-Based Phase Scheduling

**Decision.** Phases declare dependencies via YAML frontmatter (`dependsOn` field). Ridgeline builds a directed acyclic graph, validates it (no cycles, no missing references), and schedules execution in waves using Kahn's algorithm. Phases without explicit dependencies implicitly depend on the preceding phase, preserving backward compatibility with sequential builds.

**Alternatives considered.** Strictly sequential execution. Fully parallel execution with a global barrier. User-specified execution order via a separate manifest file.

**Why this approach.** Sequential execution wastes time when phases are independent (e.g., "set up CI" and "implement auth" have no dependency). Fully parallel execution ignores real constraints and produces merge conflicts. A separate manifest duplicates information already expressible in phase metadata. The DAG model captures the actual dependency structure and extracts maximum parallelism without user intervention. The `hasParallelism` function allows Ridgeline to detect and report when a build can benefit from concurrent execution. DAG scheduling benchmarks[^16] demonstrate 30-50% wall-clock reduction on real-world task graphs compared to sequential execution. The TIPG model for task scheduling[^17] formalizes the relationship between task granularity, inter-task communication, and parallel efficiency, supporting Ridgeline's phase-level granularity as the right abstraction boundary. The implicit sequential fallback ensures that existing phase specs continue to work without modification, following the principle of backward-compatible extension.

[^16]: DAG Scheduling Benchmarks. Springer, 2024. <https://link.springer.com/chapter/10.1007/978-3-031-49435-2_1>
[^17]: TIPG Model for Task Scheduling. Future Generation Computer Systems. <https://www.sciencedirect.com/science/article/abs/pii/S0167739X16301406>

---

## 8. Retry with Backoff and Jitter

**Decision.** Failed build and review invocations are classified as either fatal (authentication errors, invalid keys) or transient (timeouts, rate limits, network resets). Transient failures trigger exponential backoff with jitter: base delay doubles per attempt (capped at 60 seconds), plus random jitter up to 50% of the base. Fatal errors halt immediately.

**Alternatives considered.** Fixed-interval retries. Immediate retries without delay. No automatic retries, requiring manual re-invocation.

**Why this approach.** Fixed-interval retries risk thundering-herd effects when multiple phases hit rate limits simultaneously. Immediate retries amplify transient overload conditions. No retries force human intervention for problems that resolve themselves in seconds. Error classification prevents wasting retries on permanent failures (expired credentials will not spontaneously heal) while remaining persistent against genuinely transient issues. The AWS Builders Library article on timeouts, retries, and backoff with jitter[^18] provides the canonical treatment: exponential backoff spreads retry load over time, and jitter decorrelates concurrent retriers. Ridgeline's implementation follows this guidance precisely, with the `backoffMs` function computing `min(1000 * 2^attempt, 60000) + random(0, base * 0.5)`. Research on exponential backoff[^19] in distributed systems confirms that jittered exponential backoff achieves near-optimal throughput under contention while bounding worst-case latency. The pattern-matching error classifier (`FATAL_PATTERNS`, `TRANSIENT_PATTERNS`) is deliberately conservative: unrecognized errors default to transient, erring on the side of retry rather than premature failure.

[^18]: AWS. "Timeouts, Retries, and Backoff with Jitter." AWS Builders Library. <https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/>
[^19]: "Exponential Backoff." ResearchGate, 2024. <https://www.researchgate.net/publication/381653091_EXPONENTIAL_BACKOFF>

---

## 9. Durable Execution via Event Log

**Decision.** Ridgeline appends structured events to `trajectory.jsonl` -- an append-only, newline-delimited JSON log. Each entry records a timestamp, event type, phase ID, human-readable summary, and optional metrics (duration, token counts, cost). The log is never modified or truncated during a build.

**Alternatives considered.** Structured database logging. In-memory event collection written at build completion. Unstructured text logs.

**Why this approach.** A database adds an external dependency. In-memory collection loses data on crash -- precisely when the log is most valuable. Unstructured text logs require custom parsers for every consumer. JSONL combines the simplicity of append-only file I/O with the structure needed for programmatic analysis. Each line is independently parseable, so a corrupted final line (from a crash mid-write) does not invalidate the entire log. Event sourcing patterns[^20] establish that an append-only event log serves as both the audit trail and the source of truth for system state reconstruction. CQRS (Command Query Responsibility Segregation)[^21] separates the write path (append to JSONL) from the read path (parse and aggregate), which Ridgeline implements via the `logTrajectory` / `readTrajectory` split. The trajectory log enables post-build analysis: identifying slow phases, tracking cost trends across builds, and diagnosing failure patterns. Because each entry is self-contained with its own timestamp, the log remains useful even when `state.json` is manually edited or reset.

[^20]: Fowler, M. "Event Sourcing." martinfowler.com, 2005.
[^21]: Young, G. "CQRS Documents." 2010. <https://cqrs.files.wordpress.com/2010/11/cqrs_documents.pdf>
