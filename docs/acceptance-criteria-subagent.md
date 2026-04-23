# Proposal: Ephemeral Acceptance-Criteria Sub-Agent

Status: idea, not scheduled.

## Motivation

Ridgeline build phases declare acceptance criteria as numbered, testable statements (regex-exact strings, file paths, API shapes, snapshot assertions). Today the builder agent interprets these criteria and writes vitests inline, mixing test authoring with feature implementation in a single context window.

Two observable costs:

1. **Context pressure.** A phase with 30+ criteria pulls 10–15K tokens of test code into the main builder's context alongside the feature code, prompt assembly, and trajectory-log plumbing. Phase 3 (lean ensembles + structured verdicts + caching) and phase 4 (dashboard) hit this first.
2. **Skill mismatch.** Feature implementation requires architectural judgment; vitest authoring from a criterion list is a more mechanical translation. Running both under one agent wastes the agent's reasoning budget on boilerplate.

## Proposal

Add an ephemeral, phase-scoped sub-agent — `acceptance-criteria-writer` — that the main builder spawns per criterion cluster. Input: the criterion text plus the minimum file-tree context the criterion touches. Output: one or more vitest files, checked in against the phase's test budget.

Boundaries:

- **Ephemeral.** Spawned per cluster, discarded after the tests are written. No persistent state, no memory.
- **Scoped to criteria.** Cannot author feature code. Receives read-only fixtures and the existing test conventions; emits vitests only.
- **Returns a diff, not commentary.** The main builder applies the diff and moves on.

## What the sub-agent sees

- The criterion text (literal, unparaphrased).
- The phase's `constraints.md` and `taste.md` excerpts relevant to test style.
- A curated slice of the repo: existing test files in the same area, fixtures, and the files the criterion will exercise (the feature code if it already exists, or the interface signature if not).
- The vitest helper conventions the project already uses (stub patterns, fixture layout).

It does **not** see: the broader spec, the phase goal, unrelated criteria from other clusters, or past trajectory events.

## Why this might work

- The criterion-to-vitest translation is largely mechanical once the agent knows the project's stub/fixture conventions.
- Cluster scoping means one sub-agent handles, e.g., all of phase 3a's "structured verdict agreement" criteria (11–19) in one pass, not one criterion at a time.
- The main builder's context stays focused on feature code and architectural decisions; test scaffolding is produced in parallel and merged.

## Why it might not

- Vitests that cross-reference feature code the main builder hasn't written yet produce broken tests that the main builder must then repair — potentially a net loss.
- Criterion wording that bakes in implementation details (exact error strings, exact file names) forces the sub-agent to coordinate with the main builder, eroding the isolation.
- Adds a new failure surface: a sub-agent that misreads a criterion produces tests that pass for the wrong reason.

## When to revisit

After the first 0.8.0 phase that visibly strains the builder's context window. If phase 3a or phase 4 runs long on token budget primarily due to test code, this proposal earns its spot on the queue. Otherwise, park it.

## Open questions

1. Does the sub-agent receive the feature code as it exists in the builder's working tree, or a frozen snapshot? (Racing against the builder is risky.)
2. How are test failures routed? Back to the sub-agent for a fix pass, or to the main builder?
3. Is the sub-agent itself a Claude subprocess, or is it implemented via the SDK's native sub-agent primitives?
